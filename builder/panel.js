'use strict';

const Path = require('path');
const { loadConfigFile, saveConfigFile } = require('../lib/config-store');

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

function projectRootFromPanel(panel) {
    if (panel.options && panel.options.project) {
        return panel.options.project;
    }
    if (typeof Editor !== 'undefined' && Editor.Project && Editor.Project.path) {
        return Editor.Project.path;
    }
    return '';
}

function persistBuildFields(panel, fields) {
    const projectRoot = projectRootFromPanel(panel);
    const current = loadConfigFile(EXTENSION_ROOT);
    saveConfigFile(EXTENSION_ROOT, {
        ...current,
        uploadOnBuild: fields.uploadOnBuild ?? current.uploadOnBuild,
        keyPrefix: fields.keyPrefix ?? current.keyPrefix,
        cdnVersion: fields.cdnVersion ?? current.cdnVersion,
    }, projectRoot || undefined);
}

function syncFromFile(panel) {
    const cfg = loadConfigFile(EXTENSION_ROOT);
    const current = getPkgOptions(panel);

    panel.$.uploadToQiniu.value = cfg.uploadOnBuild ?? current.uploadToQiniu;
    panel.$.qiniuKeyPrefix.value = cfg.keyPrefix || current.qiniuKeyPrefix || '';
    panel.$.qiniuCdnVersion.value = cfg.cdnVersion || current.qiniuCdnVersion || '';

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
    <ui-label class="build-hint" value="上传路径为 版本号/Key 前缀/resources/...；版本号以「七牛云上传」面板保存的配置为准。"></ui-label>
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
        const uploadOnBuild = !!panelRef.$.uploadToQiniu.value;
        dispatch(panelRef, 'uploadToQiniu', uploadOnBuild);
        persistBuildFields(panelRef, { uploadOnBuild });
    });
    panelRef.$.qiniuKeyPrefix.addEventListener('change', () => {
        const keyPrefix = panelRef.$.qiniuKeyPrefix.value || '';
        dispatch(panelRef, 'qiniuKeyPrefix', keyPrefix);
        persistBuildFields(panelRef, { keyPrefix });
    });
    panelRef.$.qiniuKeyPrefix.addEventListener('confirm', () => {
        const keyPrefix = panelRef.$.qiniuKeyPrefix.value || '';
        dispatch(panelRef, 'qiniuKeyPrefix', keyPrefix);
        persistBuildFields(panelRef, { keyPrefix });
    });
    panelRef.$.qiniuCdnVersion.addEventListener('change', () => {
        const cdnVersion = panelRef.$.qiniuCdnVersion.value || '';
        dispatch(panelRef, 'qiniuCdnVersion', cdnVersion);
        persistBuildFields(panelRef, { cdnVersion });
    });
    panelRef.$.qiniuCdnVersion.addEventListener('confirm', () => {
        const cdnVersion = panelRef.$.qiniuCdnVersion.value || '';
        dispatch(panelRef, 'qiniuCdnVersion', cdnVersion);
        persistBuildFields(panelRef, { cdnVersion });
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
