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

    dispatch(panel, 'uploadToQiniu', !!panel.$.uploadToQiniu.value);
    dispatch(panel, 'qiniuKeyPrefix', panel.$.qiniuKeyPrefix.value || '');
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
    <ui-label class="build-hint" value="Key 前缀填 remote；Cocos 资源服务器地址填 CDN 根域名（勿带 /remote/）"></ui-label>
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
