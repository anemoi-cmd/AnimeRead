use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::ErrorKind,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::Manager;

pub const SUPPORTED: &[&str] = &[
    "txt", "epub", "pdf", "cbz", "zip", "png", "jpg", "jpeg", "webp", "avif", "gif", "bmp",
];
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBook {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: String,
    pub revision: String,
    pub format: String,
    #[serde(default)]
    pub fingerprint: String,
    #[serde(default)]
    pub stamp: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub available: bool,
}
pub fn file_stamp(path: &Path) -> Result<(u64, String), String> {
    let metadata = fs::metadata(path).map_err(|_| {
        "原文件已移动或不存在，请重新拖入文件以更新位置；也可以右键删除书目".to_string()
    })?;
    if !metadata.is_file() {
        return Err("请选择书籍文件".into());
    }
    let modified = metadata
        .modified()
        .ok()
        .and_then(|x| x.duration_since(UNIX_EPOCH).ok())
        .map(|x| x.as_nanos())
        .unwrap_or(0);
    Ok((metadata.len(), format!("{}-{modified}", metadata.len())))
}
fn fingerprint(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn zip_text(archive: &mut zip::ZipArchive<File>, name: &str) -> Result<String, String> {
    let entry = archive.by_name(name).map_err(|e| e.to_string())?;
    if entry.size() > 2 * 1024 * 1024 {
        return Err("EPUB 元数据过大".into());
    }
    let mut bytes = Vec::new();
    entry
        .take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}
fn epub_category(path: &Path) -> Result<&'static str, String> {
    let mut archive = zip::ZipArchive::new(File::open(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let container = zip_text(&mut archive, "META-INF/container.xml")?;
    let doc = roxmltree::Document::parse(&container).map_err(|e| e.to_string())?;
    let package = doc
        .descendants()
        .find(|n| n.has_tag_name("rootfile"))
        .and_then(|n| n.attribute("full-path"))
        .ok_or("缺少 EPUB package")?;
    let package_text = zip_text(&mut archive, package)?;
    let doc = roxmltree::Document::parse(&package_text).map_err(|e| e.to_string())?;
    if doc.descendants().any(|n| {
        n.has_tag_name("meta")
            && n.attribute("name") == Some("book-type")
            && matches!(n.attribute("content"), Some("comic" | "manga"))
    }) {
        return Ok("comic");
    }
    let pages: Vec<_> = doc
        .descendants()
        .filter(|n| n.has_tag_name("itemref") && n.attribute("linear") != Some("no"))
        .take(6)
        .collect();
    if pages.is_empty() {
        return Ok("novel");
    }
    for reference in pages {
        let href = doc
            .descendants()
            .find(|n| n.has_tag_name("item") && n.attribute("id") == reference.attribute("idref"))
            .and_then(|n| n.attribute("href"))
            .ok_or("缺少章节")?;
        let resource = Path::new(package)
            .parent()
            .unwrap_or(Path::new(""))
            .join(href)
            .to_string_lossy()
            .replace('\\', "/");
        let text = zip_text(&mut archive, &resource)?;
        let content = roxmltree::Document::parse_with_options(
            &text,
            roxmltree::ParsingOptions {
                allow_dtd: true,
                ..Default::default()
            },
        )
        .map_err(|e| e.to_string())?;
        let body = content
            .descendants()
            .find(|n| n.has_tag_name("body"))
            .ok_or("缺少正文")?;
        let images = body
            .descendants()
            .filter(|n| n.has_tag_name("img") || n.has_tag_name("image"))
            .count();
        let text_chars = body
            .descendants()
            .filter(|n| n.is_text())
            .filter_map(|n| n.text())
            .flat_map(str::chars)
            .filter(|c| !c.is_whitespace())
            .count();
        if images != 1 || text_chars > 120 {
            return Ok("novel");
        }
    }
    Ok("comic")
}
pub fn book_info(path: &Path) -> Result<LocalBook, String> {
    let canonical = fs::canonicalize(path)
        .map_err(|_| "原文件不存在，请重新拖入文件或右键删除书目".to_string())?;
    let (size, stamp) = file_stamp(&canonical)?;
    let format = canonical
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !SUPPORTED.contains(&format.as_str()) {
        return Err(format!("暂不支持 {format} 格式"));
    }
    let fingerprint = fingerprint(&canonical)?;
    let category = match format.as_str() {
        "txt" | "pdf" => "novel",
        "epub" => epub_category(&canonical).unwrap_or("novel"),
        _ => "comic",
    };
    Ok(LocalBook {
        id: format!("local-{fingerprint}"),
        name: canonical
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        path: canonical.to_string_lossy().into_owned(),
        size: size.to_string(),
        revision: format!("sha256:{fingerprint}"),
        fingerprint,
        stamp,
        format,
        category: category.into(),
        aliases: vec![],
        available: true,
    })
}
pub fn library_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = match std::env::var_os("ANIMEREAD_DATA_DIR") {
        Some(path) => {
            let path = PathBuf::from(path);
            if !path.is_absolute() {
                return Err("ANIMEREAD_DATA_DIR 必须为绝对路径".into());
            }
            path
        }
        None => app.path().app_data_dir().map_err(|e| e.to_string())?,
    };
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory.join("library.json"))
}
pub fn persist_library(app: &tauri::AppHandle, books: &[LocalBook]) -> Result<(), String> {
    let path = library_path(app)?;
    let pending = path.with_extension("pending");
    let mut file = File::create(&pending).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(books).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&pending, &path).map_err(|e| e.to_string())
}
/// Content identity survives moves. Keep the old ID to retain progress/bookmarks.
pub fn merge_book(books: &mut Vec<LocalBook>, mut incoming: LocalBook) -> LocalBook {
    let matches: Vec<usize> = books
        .iter()
        .enumerate()
        .filter(|(_, old)| {
            old.path.eq_ignore_ascii_case(&incoming.path)
                || (!old.fingerprint.is_empty() && old.fingerprint == incoming.fingerprint)
                || (old.fingerprint.is_empty()
                    && !Path::new(&old.path).is_file()
                    && old.name == incoming.name
                    && old.size == incoming.size)
        })
        .map(|(i, _)| i)
        .collect();
    if let Some(&first) = matches.first() {
        incoming.id = books[first].id.clone();
        for &index in &matches {
            incoming
                .aliases
                .extend(books[index].aliases.iter().cloned());
            if books[index].id != incoming.id {
                incoming.aliases.push(books[index].id.clone());
            }
        }
        incoming.aliases.sort();
        incoming.aliases.dedup();
        for &index in matches.iter().rev() {
            books.remove(index);
        }
    }
    books.push(incoming.clone());
    incoming
}
fn read_library(path: &Path) -> Result<(Vec<LocalBook>, Option<String>), String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok((Vec::new(), None)),
        Err(error) => return Err(format!("无法读取书架记录：{error}")),
    };
    match serde_json::from_slice(&bytes) {
        Ok(books) => Ok((books, None)),
        Err(_) => {
            let backup = path.with_extension(format!("damaged-{}.json", uuid::Uuid::new_v4()));
            fs::copy(path, &backup).map_err(|e| format!("无法保存书架恢复备份：{e}"))?;
            Ok((
                Vec::new(),
                Some(format!(
                    "书架记录损坏，已保留备份：{}。可重新导入书籍。",
                    backup.display()
                )),
            ))
        }
    }
}
pub fn load_and_migrate(
    app: &tauri::AppHandle,
) -> Result<(Vec<LocalBook>, Option<String>), String> {
    let (old, notice) = read_library(&library_path(app)?)?;
    let mut books = Vec::new();
    for mut book in old {
        // Retire only our previous bundled fixture entries, as requested.
        if book
            .path
            .replace('\\', "/")
            .contains("/AnimeRead/fixtures/")
        {
            continue;
        }
        let unchanged = !book.fingerprint.is_empty()
            && file_stamp(Path::new(&book.path)).is_ok_and(|(_, stamp)| stamp == book.stamp);
        if unchanged {
            book.available = true;
        } else if let Ok(fresh) = book_info(Path::new(&book.path)) {
            book.path = fresh.path;
            book.size = fresh.size;
            book.stamp = fresh.stamp;
            book.revision = fresh.revision;
            book.fingerprint = fresh.fingerprint;
            book.category = fresh.category;
            book.available = true;
        } else {
            book.available = false;
            if book.category.is_empty() {
                book.category = if ["txt", "epub", "pdf"].contains(&book.format.as_str()) {
                    "novel"
                } else {
                    "comic"
                }
                .into();
            }
        }
        merge_book(&mut books, book);
    }
    persist_library(app, &books)?;
    Ok((books, notice))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn damaged_library_is_backed_up_without_overwriting_source() {
        let directory =
            std::env::temp_dir().join(format!("animeread-recovery-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("library.json");
        let damaged = b"[{\"id\":\"interrupted";
        fs::write(&path, damaged).unwrap();
        let (books, notice) = read_library(&path).unwrap();
        assert!(books.is_empty());
        assert!(notice.unwrap().contains("已保留备份"));
        assert_eq!(fs::read(&path).unwrap(), damaged);
        let files: Vec<_> = fs::read_dir(&directory)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        assert_eq!(files.len(), 2);
        assert!(files.iter().all(|file| fs::read(file).unwrap() == damaged));
        for file in files {
            fs::remove_file(file).unwrap();
        }
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn new_or_empty_library_needs_no_recovery() {
        let path =
            std::env::temp_dir().join(format!("animeread-empty-{}.json", uuid::Uuid::new_v4()));
        assert_eq!(read_library(&path).unwrap().1, None);
        fs::write(&path, b"[]").unwrap();
        let (books, notice) = read_library(&path).unwrap();
        assert!(books.is_empty());
        assert!(notice.is_none());
        fs::remove_file(path).unwrap();
    }
}
