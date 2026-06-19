'use strict';

const fs = require('fs');
const path = require('path');

function ensurePackIgnore(config, folderName) {
    config.packOptions = config.packOptions || {};
    const ignore = Array.isArray(config.packOptions.ignore) ? config.packOptions.ignore : [];
    const exists = ignore.some((item) => item && item.type === 'folder' && item.value === folderName);
    if (!exists) {
        ignore.push({ type: 'folder', value: folderName });
    }
    config.packOptions.ignore = ignore;
}

/**
 * 微信开发者工具对 md5 文件名、隔离上下文兼容较差，构建后修正 project.config.json。
 * @param {string} buildDest
 */
function patchWechatProjectConfig(buildDest) {
    const configPath = path.join(buildDest, 'project.config.json');
    if (!fs.existsSync(configPath)) {
        return false;
    }

    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    config.compileType = 'game';
    config.miniprogramRoot = config.miniprogramRoot || './';
    config.setting = config.setting || {};
    config.setting.useIsolateContext = false;
    config.setting.enhance = false;
    config.setting.es6 = true;
    config.setting.minified = true;
    // 开发阶段允许访问未配置到微信后台的 CDN 域名
    config.setting.urlCheck = false;

    const remoteDir = path.join(buildDest, 'remote');
    if (fs.existsSync(remoteDir)) {
        // 静态资源已上 CDN 后，发布到微信时不再打包 remote/（避免首包虚胖、误传 CDN 目录）
        ensurePackIgnore(config, 'remote');
    }

    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 4)}\n`, 'utf8');
    return true;
}

/**
 * 七牛上传成功后删除构建目录中的 remote/，确保微信首包只保留 game.js 等本地入口。
 * @param {string} buildDest
 */
function stripRemoteDir(buildDest) {
    const remoteDir = path.join(buildDest, 'remote');
    if (!fs.existsSync(remoteDir)) {
        return false;
    }
    fs.rmSync(remoteDir, { recursive: true, force: true });
    return true;
}

function assertGameJsExists(buildDest) {
    const gameJs = path.join(buildDest, 'game.js');
    if (!fs.existsSync(gameJs)) {
        throw new Error(
            `构建产物缺少首包入口 game.js：${gameJs}。请确认发布平台为微信小游戏且构建成功。`,
        );
    }
}

function findSettingsFiles(buildDest) {
    const srcDir = path.join(buildDest, 'src');
    if (!fs.existsSync(srcDir)) {
        return [];
    }
    return fs.readdirSync(srcDir)
        .filter((name) => /^settings(\..*)?\.json$/i.test(name))
        .map((name) => path.join(srcDir, name));
}

/**
 * 版本化 CDN 上传后，运行时资源服务器也必须指向同一个版本目录。
 * @param {string} buildDest
 * @param {string} serverUrl 形如 https://cdn.example.com/remote/v1/
 */
function patchWechatResourceServer(buildDest, serverUrl) {
    const settingsFiles = findSettingsFiles(buildDest);
    let changed = false;
    for (const file of settingsFiles) {
        const raw = fs.readFileSync(file, 'utf8');
        const settings = JSON.parse(raw);
        settings.assets = settings.assets || {};
        if (settings.assets.server === serverUrl) {
            continue;
        }
        settings.assets.server = serverUrl;
        fs.writeFileSync(file, `${JSON.stringify(settings)}\n`, 'utf8');
        changed = true;
    }
    return changed;
}

function removeIfExists(filePath) {
    if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
    }
}

const TRANSPARENT_PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lUz4tgAAAABJRU5ErkJggg==',
    'base64',
);
const BLACK_JPG_1X1 = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABC//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=',
    'base64',
);

function writeTransparentPngIfMissing(filePath) {
    if (fs.existsSync(filePath)) {
        return false;
    }
    fs.writeFileSync(filePath, TRANSPARENT_PNG_1X1);
    return true;
}

function writeBlackJpgIfMissing(filePath) {
    if (fs.existsSync(filePath)) {
        return false;
    }
    fs.writeFileSync(filePath, BLACK_JPG_1X1);
    return true;
}

/**
 * 把 Cocos 默认启动画面（first-screen.js）换成游戏主视觉，做到与游戏首页无缝衔接。
 *
 * 两种模式（由 opts 决定，优先 bgSrcPath）：
 * - 全屏封面模式（bgSrcPath）：用竖版封面铺满全屏 + 进度条，外观与游戏首页一致，
 *   微信加载完直接呈现首页画面，几乎察觉不到 Cocos 启动画面的存在。
 * - Logo 模式（仅 logoSrcPath）：深色背景 + 居中游戏 logo + 进度条。
 *
 * 两种模式都会去掉 "Powered by Cocos" 标语，并把进度条改成游戏青色。
 * 该文件每次构建都会重新生成，因此每次构建后都需重新 patch。
 *
 * @param {string} buildDest 构建输出目录
 * @param {string|{logoSrcPath?:string,bgSrcPath?:string}} [opts] 源图配置；
 *        传字符串时按 logoSrcPath 处理（向后兼容）
 * @returns {boolean} 是否发生修改
 */
function patchFirstScreen(buildDest, opts) {
    const firstScreenPath = path.join(buildDest, 'first-screen.js');
    if (!fs.existsSync(firstScreenPath)) {
        return false;
    }

    const options = typeof opts === 'string' ? { logoSrcPath: opts } : (opts || {});
    const bgSrcPath = options.bgSrcPath;
    const logoSrcPath = options.logoSrcPath;

    let code = fs.readFileSync(firstScreenPath, 'utf8');
    const original = code;
    let assetsChanged = false;

    // 去掉 Cocos 默认标语（slogan.png）
    code = code.replace(/let useDefaultLogo = [^;]+;/, 'let useDefaultLogo = false;');
    // 深色背景（近黑紫，作为封面/ logo 之外的填充，与游戏首页统一）
    code = code.replace(/let bgColor = \[[^\]]*\];/, 'let bgColor = [8 / 255, 6 / 255, 16 / 255, 1];');
    // 进度条配色：青色，呼应游戏剑光
    code = code.replace(
        /let progressBarColor = \[[^\]]*\];/,
        'let progressBarColor = [61 / 255, 197 / 255, 222 / 255, 1];',
    );

    const hasBg = bgSrcPath && fs.existsSync(bgSrcPath);

    if (hasBg) {
        // 全屏封面模式：封面自带标题与人物，无需再叠加 logo
        const ext = path.extname(bgSrcPath) || '.png';
        const bgName = `background${ext}`;
        fs.copyFileSync(bgSrcPath, path.join(buildDest, bgName));
        code = code.replace(/let useCustomBg = [^;]+;/, 'let useCustomBg = true;');
        code = code.replace(/let useLogo = [^;]+;/, 'let useLogo = false;');
        code = code.replace(/let bgName = ['"][^'"]*['"];/, `let bgName = '${bgName}';`);
        // 铺满全屏（cover）：填满宽高、必要时裁切边缘，避免黑边
        code = code.replace(/let fitWidth = [^;]+;/, 'let fitWidth = true;');
        code = code.replace(/let fitHeight = [^;]+;/, 'let fitHeight = true;');
        // 微信开发者工具会静态处理 first-screen.js 中的 logo/slogan 引用，保留透明占位避免 ENOENT。
        assetsChanged = writeTransparentPngIfMissing(path.join(buildDest, 'logo.png')) || assetsChanged;
        assetsChanged = writeTransparentPngIfMissing(path.join(buildDest, 'slogan.png')) || assetsChanged;
        assetsChanged = writeBlackJpgIfMissing(path.join(buildDest, 'background.jpg')) || assetsChanged;
        if (bgName !== 'background.png') {
            removeIfExists(path.join(buildDest, 'background.png'));
        }
    } else if (logoSrcPath && fs.existsSync(logoSrcPath)) {
        // Logo 模式：深色背景 + 居中游戏 logo
        code = code.replace(/let useLogo = [^;]+;/, 'let useLogo = true;');
        const ext = path.extname(logoSrcPath) || '.png';
        const logoName = `logo${ext}`;
        fs.copyFileSync(logoSrcPath, path.join(buildDest, logoName));
        code = code.replace(/let logoName = '[^']*';/, `let logoName = '${logoName}';`);
        if (logoName !== 'logo.png') {
            removeIfExists(path.join(buildDest, 'logo.png'));
        }
        assetsChanged = writeTransparentPngIfMissing(path.join(buildDest, 'slogan.png')) || assetsChanged;
    }

    if (code === original && !assetsChanged) {
        return false;
    }
    fs.writeFileSync(firstScreenPath, code, 'utf8');
    return true;
}

module.exports = {
    patchWechatProjectConfig,
    patchWechatResourceServer,
    stripRemoteDir,
    assertGameJsExists,
    patchFirstScreen,
};
