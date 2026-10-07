//! 发布更新只接受官方仓库中的 HTTPS 包，并由 Tauri 验证签名。
//! 安装版交给 NSIS；便携版解包到独立暂存区，退出后由隐藏进程替换，
//! 出错则回滚。书籍、data、portable.flag 与开发源文件均不参与替换。
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct UpdateState {
    available: Mutex<Option<Update>>,
    busy: AtomicBool,
}
struct UpdateGuard<'a>(&'a AtomicBool);
impl Drop for UpdateGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
impl UpdateState {
    fn enter(&self) -> Result<UpdateGuard<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "正在处理更新，请稍候".to_string())?;
        Ok(UpdateGuard(&self.busy))
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    mode: &'static str,
    version: Option<String>,
    notes: Option<String>,
}
fn installed(executable: &Path) -> bool {
    executable
        .parent()
        .is_some_and(|root| root.join("uninstall.exe").is_file())
}

/// 回滚故障在下一次启动展示一次，避免更新脚本在后台失败却无提示。
pub fn take_update_notice(app: &tauri::AppHandle) -> Option<String> {
    let file = app
        .path()
        .app_local_data_dir()
        .ok()?
        .join("updates/last-result.json");
    let content = fs::read_to_string(&file).ok()?;
    let result: serde_json::Value =
        serde_json::from_str(content.trim_start_matches('\u{feff}')).ok()?;
    let _ = fs::remove_file(file);
    if result["success"].as_bool() == Some(false) {
        Some(format!(
            "便携更新未完成，已尝试还原旧版，请检查软件更新：{}",
            result["error"].as_str().unwrap_or("未知错误")
        ))
    } else {
        None
    }
}
#[tauri::command]
pub async fn check_app_update(
    app: tauri::AppHandle,
    state: State<'_, UpdateState>,
) -> Result<UpdateInfo, String> {
    let _guard = state.enter()?;
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let is_installed = installed(&executable);
    let target = if is_installed {
        "windows-x86_64"
    } else {
        "windows-x86_64-portable"
    };
    let updater = app
        .updater_builder()
        .target(target)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("无法检查更新，请检查网络后重试：{e}"))?;
    if let Some(value) = &update {
        let url = &value.download_url;
        if url.scheme() != "https"
            || url.host_str() != Some("github.com")
            || !url
                .path()
                .starts_with("/anemoi-cmd/AnimeRead/releases/download/")
        {
            return Err("更新包地址不属于 AnimeRead 官方仓库".into());
        }
    }
    let info = UpdateInfo {
        current_version: env!("CARGO_PKG_VERSION").into(),
        mode: if is_installed {
            "installed"
        } else {
            "portable"
        },
        version: update.as_ref().map(|u| u.version.clone()),
        notes: update.as_ref().and_then(|u| u.body.clone()),
    };
    *state.available.lock().map_err(|e| e.to_string())? = update;
    Ok(info)
}

/// 白名单比单独检查 ../ 更严格：更新包不能添加启动脚本或触及用户数据。
fn portable_path(name: &str, executable_name: &str) -> Result<Option<PathBuf>, String> {
    if name.contains('\\') || name.contains(':') || name.starts_with('/') {
        return Err("更新包包含非法路径".into());
    }
    let path = Path::new(name);
    if path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("更新包路径越界".into());
    }
    let relative = path
        .strip_prefix("AnimeRead")
        .map_err(|_| "更新包目录不正确")?;
    if relative == Path::new("portable.flag") {
        return Ok(None);
    }
    if relative == Path::new("AnimeRead.exe") {
        return Ok(Some(PathBuf::from(executable_name)));
    }
    if relative == Path::new("WebView2Loader.dll") {
        return Ok(Some(relative.to_path_buf()));
    }
    if relative.starts_with("runtime") && relative.components().count() > 1 {
        return Ok(Some(relative.to_path_buf()));
    }
    Err("更新包含非程序文件".into())
}
fn unpack_portable(
    bytes: &[u8],
    stage: &Path,
    executable_name: &str,
) -> Result<Vec<String>, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    if archive.len() > 1000 {
        return Err("更新包文件过多".into());
    }
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    let mut total = 0u64;
    // 先验证完整目录，再写暂存文件；只接收普通文件，不接受符号链接。
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("更新包不能包含链接".into());
        }
        let Some(relative) = portable_path(entry.name(), executable_name)? else {
            continue;
        };
        if !seen.insert(relative.to_string_lossy().to_lowercase()) {
            return Err("更新包含重复文件".into());
        }
        total = total.checked_add(entry.size()).ok_or("更新包大小溢出")?;
        if entry.size() > 128 * 1024 * 1024 || total > 256 * 1024 * 1024 {
            return Err("更新包过大".into());
        }
        files.push(relative.to_string_lossy().into_owned());
    }
    if !files.iter().any(|name| name == executable_name) {
        return Err("更新包缺少阅读器程序".into());
    }
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let Some(relative) = portable_path(entry.name(), executable_name)? else {
            continue;
        };
        let target = stage.join("incoming").join(relative);
        fs::create_dir_all(target.parent().ok_or("更新目录无效")?).map_err(|e| e.to_string())?;
        let mut content = Vec::new();
        entry.read_to_end(&mut content).map_err(|e| e.to_string())?;
        fs::write(target, content).map_err(|e| e.to_string())?;
    }
    Ok(files)
}
fn launch_portable_update(
    app: &tauri::AppHandle,
    bytes: &[u8],
    executable: &Path,
) -> Result<(), String> {
    let root = executable
        .parent()
        .ok_or("程序目录无效")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let name = executable
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("程序名称无效")?;
    let updates = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("updates");
    let stage = updates.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
    let files = unpack_portable(bytes, &stage, name)?;
    let request = serde_json::json!({ "root": root, "stage": stage, "executable": name, "pid": std::process::id(), "files": files });
    fs::write(
        stage.join("request.json"),
        serde_json::to_vec(&request).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    // BOM 让 Windows PowerShell 5.1 也能正确读取错误说明。
    fs::write(
        stage.join("apply.ps1"),
        format!("\u{feff}{}", include_str!("../windows/portable-update.ps1")),
    )
    .map_err(|e| e.to_string())?;
    let powershell =
        PathBuf::from(std::env::var_os("SystemRoot").ok_or("找不到 Windows 系统目录")?)
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let mut command = std::process::Command::new(powershell);
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(stage.join("apply.ps1"));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .spawn()
        .map_err(|e| format!("无法启动便携更新：{e}"))?;
    app.exit(0);
    Ok(())
}
#[tauri::command]
pub async fn install_app_update(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: State<'_, UpdateState>,
    expected_version: String,
) -> Result<(), String> {
    let _guard = state.enter()?;
    let mut update = state
        .available
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("请先检查更新")?;
    if update.version != expected_version {
        return Err("更新版本已变化，请重新检查".into());
    }
    update.timeout = Some(Duration::from_secs(180));
    let mut downloaded = 0u64;
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = window.emit(
                    "update-download",
                    serde_json::json!({ "downloaded": downloaded, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| format!("更新下载或签名校验失败：{e}"))?;
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    if installed(&executable) {
        update.install(bytes).map_err(|e| e.to_string())
    } else {
        launch_portable_update(&app, &bytes, &executable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_updates_never_replace_records_or_escape() {
        for path in [
            "AnimeRead/data/library.json",
            "AnimeRead/../secret",
            "AnimeRead/runtime/../../data/file",
            "AnimeRead/runtime/x:ads",
            "AnimeRead/scripts/run.ps1",
            "Other/AnimeRead.exe",
            "AnimeRead\\runtime\\x",
        ] {
            assert!(portable_path(path, "AnimeRead.exe").is_err(), "{path}");
        }
        assert_eq!(
            portable_path("AnimeRead/portable.flag", "reader.exe").unwrap(),
            None
        );
        assert_eq!(
            portable_path("AnimeRead/AnimeRead.exe", "reader.exe").unwrap(),
            Some(PathBuf::from("reader.exe"))
        );
        assert!(
            portable_path("AnimeRead/runtime/使用说明.txt", "reader.exe")
                .unwrap()
                .is_some()
        );
    }
}
