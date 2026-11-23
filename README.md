# 模型分类（dsh-go 插件）

给 dsh-go 手机 App 用的本地插件：把当前主机的模型按渠道和分类整理出来，方便切换、体检和清理，报错还能一键翻成中文。

## 功能

- **模型分类**：按「对话 / 多模态 / 生成 / 专用 / 智能体」五类分组，渠道顺序与引擎一致，不做二次排序
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
