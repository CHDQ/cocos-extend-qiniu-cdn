'use strict';

const Path = require('path');
const { loadConfigFile } = require('../lib/config-store');

const PACKAGE_NAME = 'qiniu-upload';
const EXTENSION_ROOT = Path.resolve(__dirname, '..');

let panelRef = null;

function optionKey(name) {
    return `packages.${PACKAGE_NAME}.${name}`;
}

function getPkgOptions(panel) {
    return (panel.options && panel.options.packages && panel.options.packages[PACKAGE_NAME]) || {};
}

function dispatch(panel, key, value) {
    panel.dispatch('update', optionKey(key), value);
}

function syncFromFile(panel) {
    const cfg = loadConfigFile(EXTENSION_ROOT);
    const current = getPkgOptions(panel);

    panel.$.uploadToQiniu.value = current.uploadToQiniu ?? cfg.uploadOnBuild;
    panel.$.qiniuKeyPrefix.value = current.qiniuKeyPrefix ?? cfg.keyPrefix ?? '';
    panel.$.qiniuCdnVersion.value = current.qiniuCdnVersion ?? cfg.cdnVersion ?? '';

    dispatch(panel, 'uploadToQiniu', !!panel.$.uploadToQiniu.value);
    dispatch(panel, 'qiniuKeyPrefix', panel.$.qiniuKeyPrefix.value || '');
    dispatch(panel, 'qiniuCdnVersion', panel.$.qiniuCdnVersion.value || '');
}

exports.template = `
<div class="qiniu-build-panel">
    <ui-prop>
        <ui-label slot="label" value="构建后上传七牛"></ui-label>
        <ui-checkbox slot="content" class="upload-to-qiniu"></ui-checkbox>
    </ui-prop>
    <ui-prop>
        <ui-label slot="label" value="七牛 Key 前缀"></ui-label>
        <ui-input slot="content" class="qiniu-key-prefix" placeholder="dream-abyss"></ui-input>
    </ui-prop>
    <ui-prop>
        <ui-label slot="label" value="七牛版本号"></ui-label>
        <ui-input slot="content" class="qiniu-cdn-version" placeholder="v20260619-001"></ui-input>
    </ui-prop>
    <ui-label class="build-hint" value="上传路径为 Key 前缀/版本号/resources/...；同一个版本号会覆盖同一个 CDN 文件夹。"></ui-label>
</div>
`;

exports.style = `
.qiniu-build-panel {
    padding: 4px 0;
}
.build-hint {
    display: block;
    margin-top: 8px;
    font-size: 11px;
    color: #95a5a6;
}
`;

exports.$ = {
    uploadToQiniu: '.upload-to-qiniu',
    qiniuKeyPrefix: '.qiniu-key-prefix',
    qiniuCdnVersion: '.qiniu-cdn-version',
};

exports.ready = function ready(options) {
    panelRef = this;
    panelRef.options = options;
    syncFromFile(panelRef);

    panelRef.$.uploadToQiniu.addEventListener('change', () => {
        dispatch(panelRef, 'uploadToQiniu', !!panelRef.$.uploadToQiniu.value);
    });
    panelRef.$.qiniuKeyPrefix.addEventListener('change', () => {
        dispatch(panelRef, 'qiniuKeyPrefix', panelRef.$.qiniuKeyPrefix.value || '');
    });
    panelRef.$.qiniuKeyPrefix.addEventListener('confirm', () => {
        dispatch(panelRef, 'qiniuKeyPrefix', panelRef.$.qiniuKeyPrefix.value || '');
    });
    panelRef.$.qiniuCdnVersion.addEventListener('change', () => {
        dispatch(panelRef, 'qiniuCdnVersion', panelRef.$.qiniuCdnVersion.value || '');
    });
    panelRef.$.qiniuCdnVersion.addEventListener('confirm', () => {
        dispatch(panelRef, 'qiniuCdnVersion', panelRef.$.qiniuCdnVersion.value || '');
    });
};

exports.update = async function update(options, key) {
    if (key) return;
    if (!panelRef) return;
    panelRef.options = options;
    syncFromFile(panelRef);
};

exports.close = function close() {
    if (panelRef && panelRef.$.uploadToQiniu) {
        panelRef.$.uploadToQiniu.removeEventListener('change', () => {});
    }
    panelRef = null;
};
