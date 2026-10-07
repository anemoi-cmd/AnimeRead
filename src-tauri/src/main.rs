#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod app_updates;
mod book_library;
mod gpu_enhancement;
use book_library::{book_info, file_stamp, merge_book, persist_library, LocalBook, SUPPORTED};

use serde::Serialize;
use std::{
    collections::{BTreeSet, HashMap},
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Mutex,
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

struct LocalSource {
    path: PathBuf,
    revision: String,
    size: u64,
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
        let (size, stamp) = file_stamp(Path::new(&book.path))?;
        let revision = if stamp == book.stamp {
            book.revision
        } else {
            book_info(Path::new(&book.path))?.revision
        };
        let source_id = uuid::Uuid::new_v4().to_string();
        state.sources.lock().map_err(|e| e.to_string())?.insert(
            source_id.clone(),
            LocalSource {
                path: PathBuf::from(&book.path),
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
    let (path, revision, size) = {
        let state = app.state::<ReaderState>();
        let sources = state.sources.lock().map_err(|e| e.to_string())?;
        let source = sources.get(&source_id).ok_or("书籍已关闭")?;
        (source.path.clone(), source.revision.clone(), source.size)
    };
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let (_, stamp) = file_stamp(&path)?;
        if stamp != revision {
            return Err("SOURCE_CHANGED：原文件已更新，请重新打开".to_string());
        }
        if offset > size {
            return Err("读取位置超过文件末尾".to_string());
        }
        let available = length.min((size - offset) as usize);
        let mut file = File::open(&path).map_err(|e| e.to_string())?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| e.to_string())?;
        let mut bytes = vec![0u8; available];
        file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
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
