'use strict';

const fs = require('fs');
const path = require('path');
const {
    loadConfigFile,
    resolveExtensionRoot,
    describeCredentialSource,
    loadBuildPackageOptions,
} = require('../lib/config-store');
const { uploadRemoteDir } = require('../lib/upload-remote');
const { validateRemotePayload } = require('../lib/remote-payload');
const { validateWechatBuild } = require('../lib/validate-wechat-build');
const {
    patchWechatProjectConfig,
    stripRemoteDir,
    assertGameJsExists,
    patchFirstScreen,
} = require('../lib/wechat-project-fix');

const PACKAGE_NAME = 'qiniu-upload';

exports.throwError = true;

exports.onAfterBuild = async function onAfterBuild(options, result) {
    const extensionRoot = resolveExtensionRoot(options, result);
    const pkgOptions = loadBuildPackageOptions(options, result);
    const fileConfig = loadConfigFile(extensionRoot);
    const shouldUpload = pkgOptions.uploadToQiniu ?? fileConfig.uploadOnBuild;

    if (!result || !result.dest) {
        throw new Error(`[${PACKAGE_NAME}] 无法获取构建输出目录 result.dest`);
    }

    assertGameJsExists(result.dest);

    if (patchWechatProjectConfig(result.dest)) {
        console.log(`[${PACKAGE_NAME}] 已修正 project.config.json（首包 game.js + 忽略 remote/）`);
    }

    // 全屏封面模式：与游戏首页同款封面，做到从微信加载到首页无缝衔接；
    // 若封面缺失则回退为「深色背景 + 居中 logo」模式。
    if (patchFirstScreen(result.dest, {
        bgSrcPath: path.join(extensionRoot, 'assets', 'home.jpg'),
        logoSrcPath: path.join(extensionRoot, 'assets', 'splash-logo.jpg'),
    })) {
        console.log(`[${PACKAGE_NAME}] 已替换 Cocos 启动画面为游戏首页同款封面（去标语 + 全屏封面 + 青色进度条）`);
    }

    if (!shouldUpload) {
        console.log(`[${PACKAGE_NAME}] 未开启「构建后上传七牛」，跳过 CDN 上传`);
        return;
    }

    const buildCheck = validateWechatBuild(result.dest);
    for (const warning of buildCheck.warnings) {
        console.warn(`[${PACKAGE_NAME}] 构建检查警告: ${warning}`);
    }
    if (!buildCheck.ok) {
        const detail = buildCheck.errors.map((item, index) => `${index + 1}. ${item}`).join('\n');
        console.warn(
            `[${PACKAGE_NAME}] 微信构建产物存在配置问题（仍会上传 remote/resources）：\n${detail}`,
        );
    }

    const remoteDir = path.join(result.dest, 'remote');
    let keyPrefix = String(pkgOptions.qiniuKeyPrefix ?? fileConfig.keyPrefix ?? '').trim();
    if (!keyPrefix) {
        keyPrefix = 'remote';
        console.warn(
            `[${PACKAGE_NAME}] 七牛 Key 前缀未配置，已使用默认值 "remote"。`
            + ' 引擎 CDN 路径为 {server}remote/{bundle}/...，请与构建面板「资源服务器」根域名配合使用。',
        );
    }

    const remoteBundleNames = fs.readdirSync(remoteDir).filter((name) => {
        const full = path.join(remoteDir, name);
        return fs.statSync(full).isDirectory();
    });
    const unexpectedRemote = remoteBundleNames.filter((n) => n !== 'resources');
    if (unexpectedRemote.length) {
        console.warn(
            `[${PACKAGE_NAME}] remote/ 含非 resources 目录: ${unexpectedRemote.join(', ')}。`
            + ' internal/main 不应远程，请关闭「主包远程」后重新构建，否则运行时会去 CDN 拉 internal 导致 404。',
        );
    }
    const credInfo = describeCredentialSource(extensionRoot);
    const payloadCheck = validateRemotePayload(remoteDir);

    console.log(`[${PACKAGE_NAME}] 开始上传 remote → 七牛`);
    console.log(`[${PACKAGE_NAME}] 扩展目录: ${extensionRoot}`);
    console.log(`[${PACKAGE_NAME}] 配置文件: ${credInfo.configPath}`);
    console.log(`[${PACKAGE_NAME}] 凭证摘要: AK=${credInfo.accessKey} SK=${credInfo.secretKey} bucket=${credInfo.bucket} zone=${credInfo.zone}`);
    console.log(`[${PACKAGE_NAME}] 本地目录: ${remoteDir}`);
    if (keyPrefix) {
        console.log(`[${PACKAGE_NAME}] Key 前缀: ${keyPrefix}`);
    }

    if (!payloadCheck.ok) {
        throw new Error(`[${PACKAGE_NAME}] 无法上传: ${payloadCheck.reason}`);
    }

    console.log(
        `[${PACKAGE_NAME}] 待上传: ${payloadCheck.fileCount} 个文件`
        + `（resources: ${payloadCheck.resourcesCount}）`,
    );

    const summary = await uploadRemoteDir(remoteDir, extensionRoot, {
        keyPrefix,
        onlyBundle: 'resources',
        log: (msg) => console.log(msg),
    });

    if (stripRemoteDir(result.dest)) {
        console.log(`[${PACKAGE_NAME}] 已移除构建目录中的 remote/（静态资源仅保留在七牛 CDN）`);
    }

    const stamp = {
        uploadedAt: new Date().toISOString(),
        dest: result.dest,
        bucket: summary.bucket,
        keyPrefix: summary.keyPrefix,
        uploaded: summary.uploaded,
        total: summary.total,
    };
    fs.writeFileSync(
        path.join(extensionRoot, '.qiniu-upload-last.json'),
        `${JSON.stringify(stamp, null, 2)}\n`,
        'utf8',
    );

    console.log(
        `[${PACKAGE_NAME}] 完成: ${summary.uploaded}/${summary.total} 个文件 → bucket=${summary.bucket}`,
    );
};
