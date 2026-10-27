#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod app_updates;
mod book_library;
mod gpu_enhancement;
use book_library::{book_info, merge_book, metadata_stamp, persist_library, LocalBook, SUPPORTED};

use serde::Serialize;
use std::{
    collections::{BTreeSet, HashMap},
    fs::File,
    path::Path,
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

const MAX_READ: usize = 8 * 1024 * 1024;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceInfo {
    id: String,
    source_id: String,
    name: String,
    size: String,
    revision: String,
    format: String,
}

/// 打开的书保持一个文件句柄，按位置读取，不再每次重新打开。Windows 上
/// 标准库以允许删除/改名的共享方式打开，用户仍可移动或替换原文件。
struct LocalSource {
    file: Arc<File>,
    revision: String,
    size: u64,
}
/// 从指定位置读满缓冲区；多个读取可同时使用同一句柄。
fn read_exact_at(file: &File, buffer: &mut [u8], offset: u64) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        let mut done = 0;
        while done < buffer.len() {
            let count = file.seek_read(&mut buffer[done..], offset + done as u64)?;
            if count == 0 {
                return Err(std::io::ErrorKind::UnexpectedEof.into());
            }
            done += count;
        }
        Ok(())
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileExt;
        file.read_exact_at(buffer, offset)
    }
}
#[derive(Default)]
struct ReaderState {
    books: Mutex<Vec<LocalBook>>,
    sources: Mutex<HashMap<String, LocalSource>>,
    startup_ids: Mutex<Vec<String>>,
    startup_notice: Mutex<Option<String>>,
    fonts: Mutex<Option<Vec<String>>>,
}

fn register_paths(
    app: &tauri::AppHandle,
    state: &ReaderState,
    paths: &[String],
) -> Result<Vec<LocalBook>, String> {
    let imports: Vec<_> = paths
        .iter()
        .map(|x| book_info(Path::new(x)))
        .collect::<Result<_, _>>()?;
    let mut books = state.books.lock().map_err(|e| e.to_string())?;
    let mut next = books.clone();
    let imported = imports
        .into_iter()
        .map(|book| merge_book(&mut next, book))
        .collect();
    persist_library(app, &next)?;
    *books = next;
    Ok(imported)
}

#[tauri::command]
fn load_library(state: State<'_, ReaderState>) -> Result<Vec<LocalBook>, String> {
    Ok(state.books.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
fn startup_books(state: State<'_, ReaderState>) -> Result<Vec<String>, String> {
    Ok(std::mem::take(
        &mut *state.startup_ids.lock().map_err(|e| e.to_string())?,
    ))
}

#[tauri::command]
fn startup_notice(state: State<'_, ReaderState>) -> Result<Option<String>, String> {
    Ok(state
        .startup_notice
        .lock()
        .map_err(|e| e.to_string())?
        .take())
}

#[tauri::command]
async fn pick_books(app: tauri::AppHandle) -> Result<Vec<LocalBook>, String> {
    let dialog_app = app.clone();
    let paths = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title("导入小说或漫画")
            .add_filter("小说与漫画", SUPPORTED)
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|x| x.into_path().ok())
            .map(|x| x.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        register_paths(&app, &app.state::<ReaderState>(), &paths)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_paths(app: tauri::AppHandle, paths: Vec<String>) -> Result<Vec<LocalBook>, String> {
    if paths.len() > 200 {
        return Err("每次最多导入 200 个文件".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        register_paths(&app, &app.state::<ReaderState>(), &paths)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn remove_book(
    app: tauri::AppHandle,
    state: State<'_, ReaderState>,
    id: String,
) -> Result<(), String> {
    let mut books = state.books.lock().map_err(|e| e.to_string())?;
    let next: Vec<_> = books
        .iter()
        .filter(|book| book.id != id && !book.aliases.contains(&id))
        .cloned()
        .collect();
    persist_library(&app, &next)?;
    *books = next;
    Ok(())
}
#[tauri::command]
async fn open_book(app: tauri::AppHandle, id: String) -> Result<SourceInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ReaderState>();
        let book = state
            .books
            .lock()
            .map_err(|e| e.to_string())?
            .iter()
            .find(|x| x.id == id)
            .cloned()
            .ok_or("书目不存在")?;
        let file = File::open(&book.path).map_err(|_| {
            "原文件已移动或不存在，请重新拖入文件以更新位置；也可以右键删除书目".to_string()
        })?;
        let (size, stamp) = metadata_stamp(&file.metadata().map_err(|e| e.to_string())?)?;
        let revision = if stamp == book.stamp {
            book.revision
        } else {
            book_info(Path::new(&book.path))?.revision
        };
        let source_id = uuid::Uuid::new_v4().to_string();
        state.sources.lock().map_err(|e| e.to_string())?.insert(
            source_id.clone(),
            LocalSource {
                file: Arc::new(file),
                revision: stamp,
                size,
            },
        );
        Ok(SourceInfo {
            id: book.id,
            source_id,
            name: book.name,
            size: size.to_string(),
            revision,
            format: book.format,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_source(
    app: tauri::AppHandle,
    source_id: String,
    offset: String,
    length: usize,
) -> Result<tauri::ipc::Response, String> {
    if length > MAX_READ {
        return Err("单次读取超过 8 MiB".into());
    }
    let offset = offset.parse::<u64>().map_err(|_| "字节偏移无效")?;
    let (file, revision, size) = {
        let state = app.state::<ReaderState>();
        let sources = state.sources.lock().map_err(|e| e.to_string())?;
        let source = sources.get(&source_id).ok_or("书籍已关闭")?;
        (source.file.clone(), source.revision.clone(), source.size)
    };
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        // 原文件被原地改写时版本戳变化；被替换时句柄仍指向打开时的内容。
        let (_, stamp) = metadata_stamp(&file.metadata().map_err(|e| e.to_string())?)?;
        if stamp != revision {
            return Err("SOURCE_CHANGED：原文件已更新，请重新打开".to_string());
        }
        if offset > size {
            return Err("读取位置超过文件末尾".to_string());
        }
        let available = length.min((size - offset) as usize);
        let mut bytes = vec![0u8; available];
        read_exact_at(&file, &mut bytes, offset).map_err(|e| e.to_string())?;
        Ok(bytes)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn close_source(state: State<'_, ReaderState>, source_id: String) -> Result<(), String> {
    state
        .sources
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&source_id);
    Ok(())
}

#[tauri::command]
async fn system_fonts(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    if let Some(fonts) = app
        .state::<ReaderState>()
        .fonts
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
    {
        return Ok(fonts);
    }
    let fonts = tauri::async_runtime::spawn_blocking(|| {
        let mut database = fontdb::Database::new();
        database.load_system_fonts();
        let names: BTreeSet<String> = database
            .faces()
            .flat_map(|face| face.families.iter().map(|(name, _)| name.clone()))
            .collect();
        names.into_iter().collect::<Vec<_>>()
    })
    .await
    .map_err(|e| e.to_string())?;
    *app.state::<ReaderState>()
        .fonts
        .lock()
        .map_err(|e| e.to_string())? = Some(fonts.clone());
    Ok(fonts)
}

#[tauri::command]
fn health() -> serde_json::Value {
    serde_json::json!({ "app": "AnimeRead", "version": env!("CARGO_PKG_VERSION"), "platform": std::env::consts::OS, "architecture": std::env::consts::ARCH, "byteSource": "native-read-at", "maxReadBytes": MAX_READ })
}

fn main() {
    // Set both stores before Tauri/WebView2 starts any threads. The ordinary
    // executable keeps the existing user profile; only an explicit portable
    // marker creates a separate profile next to the executable.
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            if directory.join("portable.flag").is_file() {
                let data = directory.join("data");
                if std::env::var_os("ANIMEREAD_DATA_DIR").is_none() {
                    std::env::set_var("ANIMEREAD_DATA_DIR", &data);
                }
                if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
                    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", data.join("webview"));
                }
            }
        }
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(app_updates::UpdateState::default())
        .manage(ReaderState::default())
        .manage(gpu_enhancement::EnhancementState::default())
        .setup(|app| {
            let handle = app.handle();
            let state = app.state::<ReaderState>();
            let (books, notice) = book_library::load_and_migrate(handle)?;
            *state.books.lock().unwrap() = books;
            *state.startup_notice.lock().unwrap() =
                match (notice, app_updates::take_update_notice(handle)) {
                    (Some(book), Some(update)) => Some(format!("{book}\n{update}")),
                    (book, update) => book.or(update),
                };
            let mut paths = Vec::new();
            let mut arguments = std::env::args().skip(1);
            while let Some(argument) = arguments.next() {
                if argument == "--open" {
                    if let Some(path) = arguments.next() {
                        paths.push(path);
                    }
                } else if !argument.starts_with('-') && Path::new(&argument).is_file() {
                    paths.push(argument);
                }
            }
            if !paths.is_empty() {
                match register_paths(handle, &state, &paths) {
                    Ok(books) => {
                        *state.startup_ids.lock().unwrap() =
                            books.into_iter().map(|x| x.id).collect()
                    }
                    Err(error) => eprintln!("{error}"),
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_library,
            startup_books,
            startup_notice,
            pick_books,
            import_paths,
            remove_book,
            open_book,
            read_source,
            close_source,
            system_fonts,
            health,
            app_updates::check_app_update,
            app_updates::install_app_update,
            gpu_enhancement::enhancement_runtime,
            gpu_enhancement::enhance_image,
            gpu_enhancement::cancel_enhancements
        ])
        .run(tauri::generate_context!())
        .expect("AnimeRead could not start");
}
