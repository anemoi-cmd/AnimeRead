//! Waifu2x 硬件能力检测与有界、可批处理的推理队列。
//! 只使用真实 Vulkan 显卡（独显／核显），不运行 CPU 模型或 CPU 重试。
//! 队列限制、代次取消和子进程超时共同保证翻页／关闭不会被推理阻塞；
//! 临时目录通过 RAII 清理，失败交给前端保留原图。
use image::ImageFormat;
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        mpsc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Manager;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub available: bool,
    pub device: String,
    pub gpu_id: Option<i32>,
    pub backend: String,
    pub temporary_files: bool,
}
#[derive(Deserialize)]
pub struct EnhanceOptions {
    pub filters: Vec<String>,
}
#[derive(Default)]
pub struct EnhancementState {
    info: Mutex<Option<RuntimeInfo>>,
    /// 等待批处理的页面；worker 表示后台批处理线程是否在运行。
    queue: Mutex<Vec<BatchItem>>,
    worker: AtomicBool,
    generation: AtomicU64,
    pending: AtomicUsize,
}
struct PendingJob<'a>(&'a AtomicUsize);
impl Drop for PendingJob<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
fn runtime_directory() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    let sibling = executable.parent()?.join("runtime/waifu2x");
    if sibling.join("waifu2x-ncnn-vulkan.exe").is_file() {
        return Some(sibling);
    }
    #[cfg(debug_assertions)]
    {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()?
            .join("runtime/waifu2x");
        let custom = std::env::var_os("ANIMEREAD_TOOLS_DIR")
            .map(|directory| PathBuf::from(directory).join("waifu2x"));
        for directory in custom.into_iter().chain(Some(development)) {
            if directory.join("waifu2x-ncnn-vulkan.exe").is_file() {
                return Some(directory);
            }
        }
    }
    None
}
fn command(directory: &PathBuf) -> Command {
    let mut command = Command::new(directory.join("waifu2x-ncnn-vulkan.exe"));
    command.current_dir(directory);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    command
}
fn detect() -> Result<RuntimeInfo, String> {
    let unavailable = || RuntimeInfo {
        available: false,
        device: String::new(),
        gpu_id: None,
        backend: "ncnn Vulkan".into(),
        temporary_files: true,
    };
    let Some(directory) = runtime_directory() else {
        return Ok(unavailable());
    };
    for file in [
        "vcomp140.dll",
        "models-cunet/scale2.0x_model.bin",
        "models-cunet/scale2.0x_model.param",
        "models-cunet/noise2_model.bin",
        "models-cunet/noise2_model.param",
    ] {
        if !directory.join(file).is_file() {
            return Ok(unavailable());
        }
    }
    let probe = TemporaryJob(
        std::env::temp_dir().join(format!("animeread-probe-{}", uuid::Uuid::new_v4())),
    );
    fs::create_dir(&probe.0).map_err(|e| e.to_string())?;
    let log_path = probe.0.join("devices.log");
    // The CLI enumerates Vulkan adapters before rejecting the probe ID. Models
    // and page images are not loaded. A bad driver cannot block startup forever.
    let child = command(&directory)
        .args([
            "-i",
            "probe.png",
            "-o",
            "unused.png",
            "-g",
            "99",
            "-s",
            "1",
            "-n",
            "0",
            "-t",
            "64",
        ])
        .stdout(Stdio::null())
        .stderr(fs::File::create(&log_path).map_err(|e| e.to_string())?)
        .spawn();
    let Ok(child) = child else {
        return Ok(unavailable());
    };
    if wait_for_child(child, Duration::from_secs(8), || false).is_err() {
        return Ok(unavailable());
    }
    let log = fs::read_to_string(log_path).unwrap_or_default();
    let selected = choose_device(
        &log,
        std::env::var("ANIMEREAD_ENHANCEMENT_DEVICE")
            .ok()
            .as_deref(),
    )?;
    // CPU 模型路径在随附版本不可用：没有真实 Vulkan 显卡就立即禁用，
    // 不再运行会崩溃的 CPU 自检或让用户等待 CPU 推理／失败重试。
    let Some((gpu_id, device)) = selected else {
        return Ok(unavailable());
    };
    Ok(RuntimeInfo {
        available: true,
        device,
        gpu_id: Some(gpu_id),
        backend: "ncnn Vulkan".into(),
        temporary_files: true,
    })
}
fn choose_device(log: &str, requested: Option<&str>) -> Result<Option<(i32, String)>, String> {
    let mut devices = Vec::new();
    for line in log.lines() {
        if let Some(value) = line
            .trim()
            .strip_prefix('[')
            .and_then(|value| value.split_once(']').map(|(value, _)| value))
        {
            if let Some((id, name)) = value.split_once(' ') {
                if let Ok(id) = id.parse::<i32>() {
                    let lower = name.to_ascii_lowercase();
                    let software = [
                        "swiftshader",
                        "llvmpipe",
                        "lavapipe",
                        "software",
                        "basic render",
                    ]
                    .iter()
                    .any(|token| lower.contains(token));
                    if id >= 0 && !software && !devices.iter().any(|(old, _)| *old == id) {
                        devices.push((id, name.to_string()));
                    }
                }
            }
        }
    }
    if requested == Some("cpu") || requested == Some("-1") {
        return Ok(None);
    }
    if let Some(requested) = requested {
        let id = requested
            .parse::<i32>()
            .map_err(|_| "增强设备应为显卡编号或 cpu")?;
        return devices
            .into_iter()
            .find(|(index, _)| *index == id)
            .map(Some)
            .ok_or("指定的增强设备不存在".into());
    }
    let priority = |name: &str| {
        if name.starts_with("NVIDIA") {
            0
        } else if name.starts_with("AMD") {
            1
        } else {
            2
        }
    };
    devices.sort_by_key(|(_, name)| priority(name));
    Ok(devices.into_iter().next())
}
fn wait_for_child(
    mut child: Child,
    timeout: Duration,
    cancelled: impl Fn() -> bool,
) -> Result<ExitStatus, String> {
    let deadline = Instant::now() + timeout;
    loop {
        let reason = if cancelled() {
            Some("增强任务已取消")
        } else if Instant::now() > deadline {
            Some("画质增强超时，已保留原图")
        } else {
            None
        };
        if let Some(reason) = reason {
            let _ = child.kill();
            let _ = child.wait();
            return Err(reason.into());
        }
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.to_string());
            }
        }
    }
}

fn runtime_info(state: &EnhancementState) -> Result<RuntimeInfo, String> {
    let mut cache = state.info.lock().map_err(|e| e.to_string())?;
    if cache.is_none() {
        *cache = Some(detect()?);
    }
    cache.clone().ok_or("GPU 设备检测失败".into())
}
#[tauri::command]
pub async fn enhancement_runtime(app: tauri::AppHandle) -> Result<RuntimeInfo, String> {
    tauri::async_runtime::spawn_blocking(move || runtime_info(&app.state::<EnhancementState>()))
        .await
        .map_err(|e| e.to_string())?
}
struct TemporaryJob(PathBuf);
impl Drop for TemporaryJob {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
#[tauri::command]
pub fn cancel_enhancements(state: tauri::State<'_, EnhancementState>) {
    state.generation.fetch_add(1, Ordering::SeqCst);
}
#[tauri::command]
pub async fn enhance_image(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let state = app.state::<EnhancementState>();
    let mut pending = state.pending.load(Ordering::SeqCst);
    loop {
        if pending >= 8 {
            return Err("增强队列已满，请稍后重试".into());
        }
        match state.pending.compare_exchange_weak(
            pending,
            pending + 1,
            Ordering::SeqCst,
            Ordering::SeqCst,
        ) {
            Ok(_) => break,
            Err(actual) => pending = actual,
        }
    }
    let _pending = PendingJob(&state.pending);
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) if bytes.len() <= 16 * 1024 * 1024 => bytes.clone(),
        tauri::ipc::InvokeBody::Raw(_) => return Err("增强输入最多 16 MiB".into()),
        _ => return Err("增强接口需要二进制页面".into()),
    };
    let filters = request
        .headers()
        .get("x-animeread-filters")
        .and_then(|header| header.to_str().ok())
        .ok_or("缺少滤镜链")?;
    let options = EnhanceOptions {
        filters: serde_json::from_str(filters).map_err(|e| e.to_string())?,
    };
    let generation = app
        .state::<EnhancementState>()
        .generation
        .load(Ordering::SeqCst);
    if bytes.len() > 16 * 1024 * 1024
        || options.filters.is_empty()
        || options.filters.len() > 4
        || options
            .filters
            .iter()
            .any(|mode| !["A", "B", "C"].contains(&mode.as_str()))
    {
        return Err("增强参数或页面大小无效".into());
    }
    // 交给后台批处理线程：排队中、滤镜相同的多页合成一批，Waifu2x 每一步
    // 只启动一次进程，摊薄约 0.8 秒的显卡初始化和模型加载。
    let (reply, result) = mpsc::channel();
    state
        .queue
        .lock()
        .map_err(|e| e.to_string())?
        .push(BatchItem {
            bytes,
            filters: options.filters,
            generation,
            reply,
        });
    if !state.worker.swap(true, Ordering::SeqCst) {
        let worker_app = app.clone();
        std::thread::spawn(move || batch_worker(worker_app));
    }
    let output = tauri::async_runtime::spawn_blocking(move || {
        result
            .recv()
            .unwrap_or_else(|_| Err("增强任务已中断".into()))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(output))
}

pub struct BatchItem {
    bytes: Vec<u8>,
    filters: Vec<String>,
    generation: u64,
    reply: mpsc::Sender<Result<Vec<u8>, String>>,
}
type PageResult = Result<Vec<u8>, String>;
/// 后台线程：短暂收集同时到达的请求，按滤镜链分组处理；队列清空即退出。
fn batch_worker(app: tauri::AppHandle) {
    let state = app.state::<EnhancementState>();
    loop {
        std::thread::sleep(Duration::from_millis(80));
        let items = {
            let Ok(mut queue) = state.queue.lock() else {
                state.worker.store(false, Ordering::SeqCst);
                return;
            };
            // 持有队列锁时判断并退出：新请求要么被本轮取走，要么会启动新线程。
            if queue.is_empty() {
                state.worker.store(false, Ordering::SeqCst);
                return;
            }
            std::mem::take(&mut *queue)
        };
        let current = state.generation.load(Ordering::SeqCst);
        let mut groups: Vec<(Vec<String>, Vec<BatchItem>)> = Vec::new();
        for item in items {
            if item.generation != current {
                let _ = item.reply.send(Err("增强任务已取消".into()));
                continue;
            }
            match groups
                .iter_mut()
                .find(|(filters, _)| *filters == item.filters)
            {
                Some((_, members)) => members.push(item),
                None => groups.push((item.filters.clone(), vec![item])),
            }
        }
        for (filters, members) in groups {
            let inputs: Vec<&[u8]> = members.iter().map(|item| item.bytes.as_slice()).collect();
            let results = match run_batch(&app, &filters, &inputs, current) {
                Ok(results) => results,
                Err(error) => members.iter().map(|_| Err(error.clone())).collect(),
            };
            for (item, result) in members.into_iter().zip(results) {
                let _ = item.reply.send(result);
            }
        }
    }
}
/// 检查一页的格式和输出尺寸，写入第一步目录，返回原图尺寸。
fn stage_input(
    directory: &Path,
    index: usize,
    bytes: &[u8],
    scale: u32,
) -> Result<(u32, u32), String> {
    // 漫画原文件多为 JPEG；直接交给 Waifu2x，免去前端 PNG 重新编码。
    let format = image::guess_format(bytes).map_err(|e| e.to_string())?;
    let extension = match format {
        ImageFormat::Png => "png",
        ImageFormat::Jpeg => "jpg",
        ImageFormat::WebP => "webp",
        _ => return Err("增强输入只支持 PNG、JPEG 或 WebP".into()),
    };
    let (width, height) = image::ImageReader::with_format(Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(|e| e.to_string())?;
    let pixels = u64::from(width) * u64::from(height) * u64::from(scale * scale);
    if width == 0 || height == 0 || pixels > 80_000_000 {
        return Err("滤镜链输出最多 8000 万像素，请减少叠加次数".into());
    }
    fs::write(directory.join(format!("{index}.{extension}")), bytes).map_err(|e| e.to_string())?;
    Ok((width, height))
}
/// 一批页面依次执行滤镜链；单页的格式或尺寸问题只影响这一页。
fn run_batch(
    app: &tauri::AppHandle,
    filters: &[String],
    inputs: &[&[u8]],
    generation: u64,
) -> Result<Vec<PageResult>, String> {
    let state = app.state::<EnhancementState>();
    let runtime = runtime_info(&state)?;
    let gpu_id = runtime
        .gpu_id
        .filter(|id| *id >= 0)
        .ok_or("未检测到可用显卡，超分已停止，保留原图")?;
    let directory = runtime_directory().ok_or("增强扩展不存在")?;
    let parent = if std::env::var_os("ANIMEREAD_DATA_DIR").is_some() {
        crate::book_library::library_path(app)?.with_file_name("cache")
    } else {
        app.path().app_cache_dir().map_err(|e| e.to_string())?
    }
    .join("enhance-jobs");
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let job = TemporaryJob(parent.join(uuid::Uuid::new_v4().to_string()));
    let mut step = job.0.join("step-0");
    fs::create_dir_all(&step).map_err(|e| e.to_string())?;
    let scale = 2u32.pow(filters.iter().filter(|mode| mode.as_str() == "A").count() as u32);
    let mut results: Vec<PageResult> = Vec::with_capacity(inputs.len());
    let mut sizes = Vec::with_capacity(inputs.len());
    let mut live = Vec::with_capacity(inputs.len());
    for (index, bytes) in inputs.iter().enumerate() {
        match stage_input(&step, index, bytes, scale) {
            Ok(size) => {
                sizes.push(size);
                live.push(index);
                results.push(Ok(Vec::new()));
            }
            Err(error) => {
                sizes.push((0, 0));
                results.push(Err(error));
            }
        }
    }
    if live.is_empty() {
        return Ok(results);
    }
    for (number, mode) in filters.iter().enumerate() {
        if state.generation.load(Ordering::SeqCst) != generation {
            return Err("增强任务已取消".into());
        }
        let next = job.0.join(format!("step-{}", number + 1));
        fs::create_dir_all(&next).map_err(|e| e.to_string())?;
        let factor = if mode == "A" { 2 } else { 1 };
        if mode == "B" {
            for &index in &live {
                soften(&staged(&step, index)?, &next.join(format!("{index}.png")))?;
            }
        } else {
            // 分块大小交给 ncnn 按显存自动选择（独显通常 400）；整批只启动一次。
            let noise = if mode == "C" { 2 } else { -1 };
            let log = job.0.join(format!("step-{number}.log"));
            let child = command(&directory)
                .arg("-i")
                .arg(&step)
                .arg("-o")
                .arg(&next)
                .args([
                    "-s",
                    &factor.to_string(),
                    "-n",
                    &noise.to_string(),
                    "-t",
                    "0",
                    "-g",
                    &gpu_id.to_string(),
                    "-j",
                    "1:2:2",
                    "-f",
                    "png",
                ])
                .arg("-m")
                .arg(directory.join("models-cunet"))
                .stdout(Stdio::null())
                .stderr(fs::File::create(&log).map_err(|e| e.to_string())?)
                .spawn()
                .map_err(|e| e.to_string())?;
            let timeout = Duration::from_secs(90 + 30 * live.len() as u64);
            let status = wait_for_child(child, timeout, || {
                state.generation.load(Ordering::SeqCst) != generation
            })?;
            if !status.success() {
                return Err(format!(
                    "画质增强失败，已保留原图：{}",
                    fs::read_to_string(&log)
                        .unwrap_or_default()
                        .chars()
                        .take(1200)
                        .collect::<String>()
                ));
            }
        }
        // 逐页核对输出尺寸，有问题的页单独报错，不影响同批其他页。
        live.retain(|&index| {
            let (width, height) = sizes[index];
            let expected = (width * factor, height * factor);
            let actual = image::ImageReader::open(next.join(format!("{index}.png")))
                .ok()
                .and_then(|reader| reader.into_dimensions().ok());
            if actual == Some(expected) {
                sizes[index] = expected;
                true
            } else {
                results[index] = Err("增强输出尺寸不匹配".into());
                false
            }
        });
        step = next;
    }
    for &index in &live {
        results[index] = fs::read(step.join(format!("{index}.png"))).map_err(|e| e.to_string());
    }
    Ok(results)
}
/// 第一步输入保留原扩展名；之后各步统一为 PNG。
fn staged(directory: &Path, index: usize) -> Result<PathBuf, String> {
    ["png", "jpg", "webp"]
        .iter()
        .map(|extension| directory.join(format!("{index}.{extension}")))
        .find(|path| path.is_file())
        .ok_or_else(|| "增强中间文件缺失".to_string())
}
/// B：保持尺寸的轻量边缘柔和，CPU 完成。
fn soften(input: &Path, output: &Path) -> Result<(), String> {
    let mut image = image::open(input).map_err(|e| e.to_string())?.to_rgba8();
    let blurred = image::imageops::blur(&image, 0.55);
    for (original, smooth) in image.pixels_mut().zip(blurred.pixels()) {
        let difference = original.0[..3]
            .iter()
            .zip(&smooth.0[..3])
            .map(|(&a, &b)| (f32::from(a) - f32::from(b)).abs())
            .sum::<f32>()
            / 3.0;
        let blend = 0.3 * (difference / 18.0).clamp(0.0, 1.0);
        for (channel, softened) in original.0[..3].iter_mut().zip(&smooth.0[..3]) {
            *channel = (*channel as f32 * (1.0 - blend) + *softened as f32 * blend).round() as u8;
        }
    }
    image.save(output).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::choose_device;
    #[test]
    fn selects_hardware_vendors_and_rejects_cpu() {
        let devices = "[0 Intel Iris Xe] queues\n[1 AMD Radeon 780M] queues\n[1 AMD Radeon 780M] fp16\n[2 NVIDIA RTX] queues";
        assert_eq!(
            choose_device(devices, None).unwrap(),
            Some((2, "NVIDIA RTX".into()))
        );
        assert_eq!(
            choose_device(devices, Some("1")).unwrap(),
            Some((1, "AMD Radeon 780M".into()))
        );
        assert_eq!(
            choose_device("[0 Intel Iris Xe] queues", None).unwrap(),
            Some((0, "Intel Iris Xe".into()))
        );
        assert_eq!(choose_device("no Vulkan adapters", None).unwrap(), None);
        assert_eq!(choose_device(devices, Some("cpu")).unwrap(), None);
        assert_eq!(choose_device(devices, Some("-1")).unwrap(), None);
        assert_eq!(choose_device("[0 Microsoft Basic Render Driver] queues\n[1 llvmpipe] queues\n[2 SwiftShader] queues", None).unwrap(), None);
        assert!(choose_device(devices, Some("99")).is_err());
        assert!(choose_device(devices, Some("invalid")).is_err());
    }
}
