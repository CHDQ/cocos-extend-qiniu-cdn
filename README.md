# qiniu-upload

Cocos Creator 扩展插件，用于将微信小游戏构建产物中的 `remote/` 远程资源自动上传到[七牛云](https://www.qiniu.com/) CDN，并辅助完成微信发布相关配置。

适用于 **Cocos Creator >= 3.7.0**，当前主要支持 **微信小游戏（wechatgame）** 构建平台。

## 功能特性

- **构建后自动上传**：微信小游戏构建完成后，将 `remote/resources` 上传到七牛云
- **手动上传**：通过扩展面板随时上传已构建的 `remote/` 目录
- **连接测试**：真实上传探针文件验证 AccessKey / SecretKey / Bucket / 区域配置
- **微信构建辅助**：
  - 自动修正 `project.config.json`（首包 `game.js`、忽略 `remote/` 目录等）
  - 替换 Cocos 默认启动画面为游戏封面，实现加载到首页的无缝衔接
  - 上传成功后自动删除构建目录中的 `remote/`，避免微信首包体积膨胀
- **构建检查**：检测远程 Bundle 配置、分包结构、MD5 Cache 等常见问题并输出警告

## 安装

### 1. 复制扩展

将本仓库复制到 Cocos 项目的 `extensions` 目录下，**文件夹名必须为 `qiniu-upload`**（与 `package.json` 中的 `name` 一致）：

```
your-cocos-project/
└── extensions/
    └── qiniu-upload/    ← 本插件
        ├── package.json
        ├── main.js
        └── ...
```

### 2. 安装依赖

在扩展目录下执行：

```bash
cd extensions/qiniu-upload
npm install
```

### 3. 启用扩展

打开 Cocos Creator，进入 **扩展 → 扩展管理器**，找到 **qiniu-upload** 并启用。

## 快速开始

### 1. 配置七牛账号

通过菜单 **扩展 → 七牛云上传 → 打开七牛云上传面板**，填写以下信息并点击 **保存配置**：

| 配置项 | 说明 |
|--------|------|
| AccessKey | 七牛控制台 AccessKey |
| SecretKey | 七牛控制台 SecretKey |
| Bucket | 存储空间名称 |
| 区域 | 存储空间所在区域（华东 z0、华北 z1 等） |
| Key 前缀 | 上传到七牛的对象 Key 前缀，如 `dream-abyss` |
| CDN 域名 | 绑定的 CDN 加速域名，如 `https://cdn.example.com` |
| 构建后自动上传 | 勾选后，微信小游戏构建完成时自动上传 |
| 构建输出目录 | 相对于项目根目录，默认 `build/wechatgame` |

配置会保存到扩展目录下的 `qiniu.config.json`。

也可以复制示例文件后手动编辑：

```bash
cp qiniu.config.example.json qiniu.config.json
```

### 2. 配置 Cocos 构建面板

在微信小游戏构建面板中：

1. 开启 **资源服务器地址**，填入 CDN **根域名**（不要带 `/remote/` 路径）
   - 例如 CDN 域名为 `https://cdn.example.com`，Key 前缀为 `dream-abyss`
   - 引擎会自动拼接为 `https://cdn.example.com/remote/resources/...`
2. 在扩展构建选项中勾选 **构建后上传七牛**（或在面板中开启「构建后自动上传」）
3. 设置 **七牛 Key 前缀**，需与面板配置一致

### 3. 构建并上传

正常执行微信小游戏构建。若已开启自动上传，构建结束后插件会：

1. 校验构建产物
2. 上传 `remote/resources/` 到七牛云
3. 删除本地构建目录中的 `remote/`
4. 写入 `.qiniu-upload-last.json` 记录本次上传摘要

也可在扩展面板点击 **立即上传 remote** 手动触发上传（需先完成一次构建）。

## 配置说明

### 配置文件 `qiniu.config.json`

```json
{
  "accessKey": "你的七牛 AccessKey",
  "secretKey": "你的七牛 SecretKey",
  "bucket": "你的存储空间名称",
  "zone": "z0",
  "keyPrefix": "remote",
  "cdnDomain": "https://你的CDN域名",
  "uploadOnBuild": false,
  "remoteBuildDir": "build/wechatgame"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `accessKey` | string | 七牛 AccessKey |
| `secretKey` | string | 七牛 SecretKey |
| `bucket` | string | 存储空间名称 |
| `zone` | string | 区域：`z0`（华东）、`z1`（华北）、`z2`（华南）、`na0`（北美）、`as0`（东南亚） |
| `keyPrefix` | string | 对象 Key 前缀，上传路径为 `{keyPrefix}/resources/{相对路径}` |
| `cdnDomain` | string | CDN 域名，供参考记录；Cocos 资源服务器地址需与此一致 |
| `uploadOnBuild` | boolean | 构建后是否自动上传 |
| `remoteBuildDir` | string | 构建输出目录，默认 `build/wechatgame` |

### 环境变量（可选）

构建钩子中也可通过环境变量覆盖凭证，优先级高于配置文件：

| 变量 | 说明 |
|------|------|
| `QINIU_AK` | AccessKey |
| `QINIU_SK` | SecretKey |
| `QINIU_BUCKET` | Bucket 名称 |
| `QINIU_ZONE` | 区域代码 |

适合在 CI/CD 流水线中使用，避免将密钥写入配置文件。

## CDN 路径规则

Cocos 引擎加载远程资源时，路径格式为：

```
{CDN根域名}/{keyPrefix}/resources/{bundle内相对路径}
```

示例：

- CDN 域名：`https://cdn.example.com`
- Key 前缀：`dream-abyss`
- 本地文件：`build/wechatgame/remote/resources/textures/bg.png`
- 七牛 Key：`dream-abyss/resources/textures/bg.png`
- 运行时 URL：`https://cdn.example.com/dream-abyss/resources/textures/bg.png`

> **注意**：Cocos 构建面板「资源服务器地址」填 CDN 根域名即可，引擎会自动拼接 `remote/` 目录结构。Key 前缀需与构建面板中的「七牛 Key 前缀」保持一致。

## 微信小游戏构建建议

为获得最佳效果，建议按以下方式配置 Cocos 项目：

| 项目 | 建议 |
|------|------|
| 远程 Bundle | 仅 `resources` 走远程 CDN |
| 主包远程 | **关闭**，避免 `internal`/`main` 远程导致运行时 404 |
| 分包 | `internal`、`main` 走微信分包（`subpackages/`） |
| MD5 Cache | 开发期建议**关闭**，避免微信开发者工具报入口文件 ENOENT |
| 分离引擎 | 开发期建议关闭 `separateEngine` |

构建后插件会自动检查上述配置，并在控制台输出错误或警告信息。

## 目录结构

```
qiniu-upload/
├── main.js                  # 扩展入口
├── package.json
├── qiniu.config.json        # 本地配置（含密钥，勿提交版本库）
├── qiniu.config.example.json
├── builder/
│   ├── index.js             # 构建扩展注册（wechatgame 平台）
│   ├── hooks.js             # 构建后钩子：上传、修正微信配置
│   └── panel.js             # 构建面板扩展 UI
├── panels/
│   └── default/
│       └── index.js         # 七牛云上传配置面板
└── lib/
    ├── config-store.js      # 配置读写
    ├── qiniu-client.js      # 七牛 SDK 封装
    ├── upload-remote.js     # 递归上传 remote 目录
    ├── remote-payload.js    # 上传前校验
    ├── validate-wechat-build.js  # 微信构建产物检查
    └── wechat-project-fix.js     # 微信项目配置修正
```

## 常见问题

### 连接测试报 401 BadToken

请确认 AccessKey 与 SecretKey 来自同一七牛账号，Bucket 名称正确，且「区域」与存储空间实际所在区域一致。

### 运行时 CDN 资源 404

1. 检查 Cocos 构建面板「资源服务器地址」是否为 CDN 根域名
2. 确认 Key 前缀与上传时一致
3. 确认七牛 Bucket 中已存在对应文件
4. 检查 `remote/` 下是否只有 `resources` 目录（不应包含 `internal`、`main`）

### 微信开发者工具报 application.js ENOENT

通常是开启了 MD5 Cache 导致入口文件名带 hash。开发期请在 Cocos 构建面板关闭 MD5 Cache。

### remote 目录不存在

需先完成一次微信小游戏构建，构建产物中才会生成 `remote/` 目录。

## 安全提示

`qiniu.config.json` 包含七牛账号密钥，**请勿提交到 Git 仓库**。建议在项目 `.gitignore` 中添加：

```
extensions/qiniu-upload/qiniu.config.json
extensions/qiniu-upload/.qiniu-upload-last.json
```

CI 环境请使用环境变量 `QINIU_AK`、`QINIU_SK` 等方式注入凭证。

## 许可证

请根据项目实际情况补充许可证信息。
