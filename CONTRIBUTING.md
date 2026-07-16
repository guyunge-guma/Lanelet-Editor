# Contributing to Lanelet Editor

感谢您考虑为 Lanelet Editor 贡献代码！

## Development Workflow

1. Fork 本仓库
2. 从 `master` 分支创建您的特性分支: `git checkout -b feat/my-feature`
3. 提交您的改动
4. 确保通过现有测试
5. 发起 Pull Request 到 `master` 分支

## Branch Naming Convention

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feat/` | 新功能 | `feat/multi-user` |
| `fix/` | 修复 Bug | `fix/lanelet-crash` |
| `refactor/` | 重构 | `refactor/backend-api` |
| `docs/` | 文档 | `docs/api-usage` |
| `chore/` | 构建/CI | `chore/docker-optimize` |

## Code Style

- **Frontend**: TypeScript + Vue 3 Composition API，遵循项目内已有的 ESLint 配置
- **Backend**: Python 3.11+，遵循 PEP 8
- 提交前请运行 `npm run typecheck` (前端) 确保类型正确

## Pull Request Guidelines

- PR 标题清晰说明改动内容
- PR 描述包含 **What**、**Why**、**How** 三要素
- 保持 PR 聚焦单一改动，避免混杂多个不相关功能
- 涉及 UI 改动的请附带截图
- CI 必须通过

## Commit Message Convention

参考 Conventional Commits:

```
feat: add multi-user collaboration support
fix: fix lanelet topology validation crash
docs: update deployment guide
refactor: extract point cloud pipeline
```

## Issues

- Bug 报告请包含：环境信息、复现步骤、期望行为、实际行为
- 功能请求请说明使用场景和期望效果

## 行为准则

请保持友善、尊重、包容的协作氛围。
