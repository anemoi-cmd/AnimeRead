/** 漫画压缩包和单图支持的图片扩展名。单独成模块，书架读取封面时
 * 不必为此加载 PDF.js 等阅读引擎代码。
 */
export const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|avif|gif|bmp)$/i;
