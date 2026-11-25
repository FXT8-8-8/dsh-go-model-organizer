# 模型管理（dsh-go 插件）

给 dsh-go 手机 App 用的本地插件：把当前主机的模型按渠道和分类整理出来，方便切换、体检和清理，报错还能一键翻成中文。

## 功能

- **模型管理**：按「对话 / 多模态 / 生成 / 专用 / 智能体」五类分组，渠道顺序与引擎一致，不做二次排序
- **渠道筛选**：进入面板自动定位到当前模型所在渠道，面板内点选不被覆盖
- **一键切换**：点模型即切换到当前对话；新对话没有会话时改设默认模型
- **通断测试**：整批测试，通了标绿点、失败标红点；再点取消；遇到账户限流会自动退避重试并单独计数
- **批量清理**：模型编辑模式支持多选、全选、批量删除（带确认）
- **报错翻译**：抓当前对话最新的报错并翻成中文，可切回原文；只翻当前对话，无报错时提示「无报错内容可供翻译」
- **实时刷新**：模型增删、渠道变更会自动反映

翻译走微软 Edge 翻译通道，不需要 key、不消耗模型额度。

## 安装

插件市场：在插件页启用「自定义插件索引」，添加索引地址后安装。

手动安装：

```sh
dsh plugin --profile web add dsh-go-model-organizer
```

装完**重启引擎并按最近任务划掉 App 再打开**，胶囊才会出现。

## 说明

- 只读引擎的模型注册表，不改 App 自带的「设置 › 模型」页面
- 删除模型、改默认模型都直接写引擎配置，删错了要去设置里加回来
- 通断测试会真实调用接口，整批测试会消耗少量额度

## 上架官方市场（ccch1mneyyy/dsh-go-market）

市场只认 npm 上的精确版本，仓库本身只存一个 JSON 条目，不托管代码。

### 1. 发 npm

```sh
npm publish --registry=https://registry.npmjs.org/ --access public
```

- 本机默认 registry 是 npmmirror，**必须显式带 `--registry`**，否则发不出去
- token 要有「Read and write + All packages」；classic 的 **Automation** 类型最省事（自带 bypass 2FA）
- 报 `Two-factor authentication or granular access token with bypass 2fa enabled is required` 就是 token 缺包权限或没勾 bypass，换 token，不要重试

### 2. 提 PR

在 `ccch1mneyyy/dsh-go-market` 的 `plugins/` 加一个 JSON：普通包 `<包名>.json`，`@scope/name` 写 `@scope__name.json`。一次 PR 只加或改一个条目，升级就改同一个文件的 `version`。

```json
{
  "name": "dsh-go-model-organizer",
  "version": "0.1.0",
  "title": { "zh": "模型管理", "en": "Model organizer" },
  "summary": { "zh": "…", "en": "…" },
  "category": "tools",
  "screenshots": [],
  "homepage": "https://github.com/FXT8-8-8/dsh-go-model-organizer"
}
```

`en` 必填；分类只能 `tools` `media` `productivity` `communication` `other`；不要写 `tier`、risk、integrity。

### 3. auto-merge 那个坑（重要）

`market/catalog` 会正常通过，但 `auto-merge` 作业必然失败：

```
GraphqlResponseError: Pull request is in unstable status
```

原因是它在自己那条检查还在 `in_progress` 时就去调 `enablePullRequestAutoMerge`，GitHub 判定 PR 状态不稳定，直接拒绝。而且失败的那条 `auto-merge` 检查本身又让 PR 一直停在 `unstable`，形成死循环。

实测无效的补救：重开 PR、推空提交换 head、等 CodeRabbit 跑完再触发——都会再失败一次，只是多几条红叉。仓库里唯一合并成功的 #60 也是同样报错、由维护者手动合的。

**结论**：`market/catalog` 绿了就别再折腾，去 PR 下留言请维护者手动 Squash and merge。合并后 `publish.yml` 每十分钟构建一次，App 插件页才搜得到。

### 4. 权限提醒

市场仓库属于 `ccch1mneyyy`。用 `FXT8-8-8` 的 token 查该仓库权限是 `push=false, admin=false`，看不到合并按钮是正常的，不是操作错了。

## 许可

MIT

## 发布与更新

安装源是本仓库里的 `market-index.json`，市场按索引里的 `source.commit` 拉取固定提交，所以**仓库必须是 Public**。

更新一个版本：

```sh
# 1. 改代码后提交
git add -A && git commit -m "说明改了什么"

# 2. 取出新提交并写进索引
SHA=$(git rev-parse HEAD)
python3 - "$SHA" <<'PY'
import json,sys
p='market-index.json'
d=json.load(open(p))
d['plugins'][0]['versions'][0]['source']['commit'] = sys.argv[1]
json.dump(d,open(p,'w'),ensure_ascii=False,indent=2); open(p,'a').write('\n')
PY
git add -A && git commit -m "锁定提交 $SHA"

# 3. 推送
git push
```

索引地址两种写法，按需要选：

| 地址 | 特点 |
|---|---|
| `https://raw.githubusercontent.com/USER/REPO/main/market-index.json` | 立即生效，适合自用 |
| `https://cdn.jsdelivr.net/gh/USER/REPO@main/market-index.json` | 有 CDN 缓存，更新可能滞后，速度快 |

要立刻让已添加索引的人拿到新版，用 raw 地址，或把索引地址换成 `@<commit>` 固定版本。

推送凭据目前明文写在 `.git/config` 的 remote 里（Personal Access Token，需 `repo` 权限）。token 过期后要重新生成并：

```sh
git remote set-url origin https://USER:新TOKEN@github.com/USER/REPO.git
```

版本号变更时同步改 `package.json` 与索引里的 `version`。
