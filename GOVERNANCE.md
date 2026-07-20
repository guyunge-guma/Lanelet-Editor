# 分支权限管理建议

## 分支模型

采用简化的 GitFlow 模型，三条长期分支 + 临时功能分支。

### 长期分支

| 分支 | 权限 | 用途 | 保护规则 |
|------|------|------|----------|
| `main` | 只读（仅合并） | 生产发布代码 | 禁止直接 push，仅通过 MR 合并；需 1 人 review |
| `develop` | 开发者可写 | 日常开发集成分支 | 需 1 人 review；CI 通过才能合并 |
| `release` | 维护者可写 | 发布分支（可选） | 仅维护者操作 |

### 临时分支

| 命名规范 | 示例 | 生命周期 |
|----------|------|----------|
| `feature/<功能名>` | `feature/undo-redo` | 合并后删除 |
| `fix/<问题名>` | `fix/arrow-overflow` | 合并后删除 |
| `hotfix/<紧急修复>` | `hotfix/health-check` | 合并后删除 |

## 权限角色

### 角色 1：Maintainer（维护者，2-3 人）

- 可合并 MR 到 `main` / `develop`
- 可管理分支保护规则
- 可发布 release tag
- 可管理 issue / milestone

### 角色 2：Developer（开发者）

- 可 push 到 `feature/*` / `fix/*` 分支
- 可创建 MR
- 可 review 他人 MR（但不能自行合并）

### 角色 3：Reporter（贡献者）

- 可提 issue
- 可 fork 仓库提交 PR
- 无直接 push 权限

## GitLab / GitHub 具体配置

### GitLab（你当前用的是 GitLab）

在 **Settings → Repository → Protected Branches**：

```
分支: main
  允许合并: Maintainer
  允许推送: No one
  需要 MR review: 1

分支: develop
  允许合并: Developer + Maintainer
  允许推送: No one
  需要 MR review: 1
```

### GitHub

在 **Settings → Branches → Branch protection rules**：

```
main:
  ✓ Require a pull request before merging
  ✓ Require approvals: 1
  ✓ Require status checks to pass (CI)
  ✓ Do not allow bypassing the above settings

develop:
  ✓ Require a pull request before merging
  ✓ Require approvals: 1
  ✓ Require status checks to pass (CI)
```

## CI/CD 建议

在 `.gitlab-ci.yml` 中配置：

```yaml
stages:
  - lint
  - build
  - test

lint:
  stage: lint
  script:
    - cd frontend && npx vue-tsc --noEmit
    - cd backend && python -m py_compile app/main.py

build:
  stage: build
  script:
    - docker compose build
  only:
    - main
    - develop
    - merge_requests

test:
  stage: test
  script:
    - docker compose up -d
    - sleep 15
    - curl -f http://localhost:8000/api/health
    - docker compose down
  only:
    - merge_requests
```

## 版本发布

采用语义化版本 `vMAJOR.MINOR.PATCH`：

```
v1.0.0  首次开源发布
v1.1.0  新增撤销/重做、自动吸附、批量操作
v1.1.1  修复箭头越界
```

发布流程：
1. `develop` → `main` 合并 MR
2. 在 `main` 上打 tag：`git tag -a v1.0.0 -m "首个开源版本"`
3. 推送 tag：`git push origin v1.0.0`
4. 创建 Release Notes（基于 milestone）

## 贡献者流程

```
1. Fork 仓库
2. 创建分支: git checkout -b feature/my-feature
3. 提交代码: git commit -m 'feat: 新增xxx功能'
4. 推送: git push origin feature/my-feature
5. 提交 MR 到 develop 分支
6. 等待 CI + Code Review
7. Maintainer 合并
```

## Commit 规范

采用 Conventional Commits：

```
feat:     新功能
fix:      修复 bug
docs:     文档变更
style:    代码格式（不影响功能）
refactor: 重构（既不是新功能也不是修 bug）
perf:     性能优化
test:     测试相关
chore:    构建/工具变更
```

示例：`fix: 箭头越界 - 根据Lanelet宽度动态计算箭头大小`
