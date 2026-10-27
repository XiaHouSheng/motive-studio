# Motive Studio 扩展方案：模型 API Key 持久化与安全管理

## 0. 现状盘点与实施对齐（2026-10-27）

> 本节为方案落地前的代码盘点，用于对齐「方案假设」与「代码现状」，收敛 P0 范围。

### 0.1 代码现状（与方案编写假设的差异）

- 后端已有 `ProviderSettingsStore`：供应商配置（名称 / Base URL / 模型 / temperature 等）**已持久化**到 sqlite `app_settings` 表（key=`provider_config`），无需再新建 `model-config.json`。
- API Key 目前**仅存服务进程内存**（`private apiKey: string | null`），重启即丢——这是 P0 要解决的核心缺口。
- 已有脱敏视图：`GET /api/settings/provider` 只返回 `hasApiKey`，从不回传明文；已有「测试连接」「清除 Key」「更换 Key（输入框留空即保持）」能力。
- `normalizeBaseUrl` 已内置 SSRF 防护（HTTPS-only、HTTP 仅 localhost、禁凭据与查询参数），对应 9.3 大部分要求。
- 第一版为单用户、单模型配置（`id=default`），`getApiKey()` 在 5 个 AI 路由中同步读取——P0 不引入 `/api/model-profiles` 多 profile REST，沿用现有 `/api/settings/provider`。
- 已有局域网手机扫码导入（`/m` 页）；配对令牌与设备权限体系属 P2。

### 0.2 P0 范围收敛（本轮实施）

1. 新增 `CredentialStore` 抽象 + 平台适配器：Windows DPAPI / macOS Keychain / Linux secret-tool（不可用时降级为本机 AES-256-GCM 加密文件，显式标注弱保护）。
2. `ProviderSettingsStore` 接入凭据存储：启动时 `restore()` 将密钥恢复进内存缓存（幂等）；`save()` 改为异步，凭据写入/删除失败必须报错，不谎报成功。
3. `getApiKey()` 保持同步内存读取——5 个现有 AI 路由零改动。
4. 脱敏视图新增 `credentialStorage`（存储方式）与 `credentialIssue`（存储异常警示）字段。
5. 前端设置弹窗：更新过时文案（不再说「重启后需重新输入」），展示存储方式与异常警示。

### 0.3 实现落点

- 新目录 `apps/server/src/services/credentials/`：接口 + 各平台适配器 + 工厂 `createCredentialStore(secretsDir)`。
- `secretsDir` 默认取 `dbPath` 同级 `secrets/`（生产即 `data/secrets`）；目录仅在首次写入时创建——测试用临时 dbPath 天然隔离，不会污染仓库 `data/`。
- 其余：`provider-settings-store.ts`、`routes/settings.ts`（PUT 改 async）、`app.ts`（`secretsDir` 选项 + 装配）、`index.ts`（listen 前 await restore）、`packages/shared/src/ai.ts`、`apps/web/src/features/settings/provider-settings-dialog.tsx`。

## 1. 项目背景

Motive Studio 已经具备后端，因此不需要依赖浏览器持久化 API Key。

当前需要解决的问题：

1. 用户每次访问或重新打开应用时，不应该重新填写 API Key。
2. API Key 不应该以明文形式保存在 `localStorage`、`sessionStorage` 或 URL 参数中。
3. 前端需要知道模型配置是否可用，但不需要获得已保存的 API Key 明文。
4. 支持修改供应商、API Base URL、模型名称以及 API Key。
5. 支持电脑端启动本地服务，手机通过局域网扫码加入工作区。
6. 后续可以扩展多供应商、多模型、配置切换和密钥轮换能力。

## 2. 设计目标与原则

### 2.1 核心目标

实现一次配置、持续使用：

- 用户首次配置供应商和 API Key。
- 后端安全保存密钥。
- 后续访问自动加载非敏感配置。
- 后端调用模型时自动读取密钥。
- 前端不需要重新填写密钥，也不需要读取密钥明文。

### 2.2 设计原则

1. **后端持有密钥**：API Key 只在必要时进入后端进程内存，并用于服务端请求。
2. **前端只管理配置状态**：前端读取供应商、模型、连接状态等脱敏信息。
3. **密钥与业务数据分离**：API Key 不应与题目、步骤、讨论消息混存在同一份普通业务数据中。
4. **默认持久化**：用户主动保存配置后，除非用户更换或删除，否则不要求重复填写。
5. **安全优先**：不记录密钥日志，不通过错误消息、调试接口或二维码泄漏密钥。
6. **兼容 Local-first**：优先支持本地运行，无需依赖云端账户才能保存配置。
7. **逐步扩展**：先完成单用户本地安全存储，再扩展多配置和多用户隔离。

---

## 3. 整体架构

```text
┌──────────────────────────────────────────┐
│            Motive Studio 前端             │
│                                          │
│  模型设置界面                             │
│  - 查看当前供应商与模型                   │
│  - 新增 / 修改配置                        │
│  - 填写或更换 API Key                     │
│  - 验证连接                               │
│                                          │
│  只获取脱敏配置，不读取已保存的密钥明文     │
└────────────────────┬─────────────────────┘
                     │ HTTPS / 本地受控连接
                     ▼
┌──────────────────────────────────────────┐
│               后端 API                    │
│                                          │
│  ModelConfigService                      │
│  - 查询配置                               │
│  - 保存配置                               │
│  - 验证密钥                               │
│  - 切换活动模型                           │
│                                          │
│  CredentialStore                         │
│  - 写入密钥                               │
│  - 读取密钥                               │
│  - 更新 / 删除密钥                        │
│                                          │
│  ModelProvider                            │
│  - 统一模型调用                           │
│  - 处理供应商差异                         │
└────────────────────┬─────────────────────┘
                     │
            ┌────────┴─────────┐
            ▼                  ▼
┌──────────────────┐  ┌────────────────────┐
│ 本地安全存储       │  │ 模型供应商 API       │
│                  │  │                    │
│ 系统凭据库 /      │  │ OpenAI 兼容接口等   │
│ 加密文件降级方案  │  │                    │
└──────────────────┘  └────────────────────┘
```

### 关键约束

- 前端永远不通过普通配置查询接口获取完整 API Key。
- 模型请求只能由后端发起。
- 供应商的 API Key 不得放入二维码、配对令牌、浏览器 URL 或前端持久化状态。
- 不能将“隐藏在输入框里的密钥”视为安全存储。

---

## 4. 密钥存储方案

### 4.1 首选：系统凭据库

如果后端运行在用户自己的电脑上，优先使用操作系统提供的凭据管理能力。

建议抽象统一接口：

```ts
export interface CredentialStore {
  get(key: string): Promise<string | null>;

  set(key: string, value: string): Promise<void>;

  delete(key: string): Promise<void>;

  has(key: string): Promise<boolean>;
}
```

根据部署环境实现不同适配器：

- Windows：Windows Credential Manager 或 Windows DPAPI 保护的凭据。
- macOS：Keychain。
- Linux：Secret Service 等系统凭据服务；不可用时使用受保护的本地加密存储。
- 容器或无桌面环境：使用部署环境提供的 Secret 管理方式。

系统凭据库并非所有环境都能直接使用，需要检查运行账户、系统服务权限和凭据服务是否可用。

### 4.2 降级方案：本地加密文件

如果当前架构不方便接入系统凭据库，可以先实现加密文件适配器。

建议存储目录：

```text
data/
  config/
    model-config.json
  secrets/
    credentials.enc
```

文件职责：

- `model-config.json`：非敏感模型配置。
- `credentials.enc`：加密后的密钥数据。

**重要：不能仅仅将 API Key 做 Base64 编码，或者将密钥直接写入 JSON 文件。**

加密方案必须同时解决密钥本身的保护问题。加密密钥应优先由系统凭据库、DPAPI 或 Keychain 等保护；不要将加密密钥和密文一起明文保存在同一个目录中。

如果暂时没有可靠的密钥保护方案，应明确限制此模式的安全等级，而不是将其描述为绝对安全。

### 4.3 存储决策

| 部署方式 | 推荐方案 |
|---|---|
| Windows 本地单用户 | Credential Manager / DPAPI |
| macOS 本地单用户 | Keychain |
| Linux 桌面环境 | Secret Service |
| 无桌面 Linux 服务 | 受保护的 Secret 文件或部署环境密钥管理 |
| 容器部署 | Secret 挂载或专用 Secret 管理方案 |
| 未来多用户云服务 | 服务端加密密钥管理、用户隔离及权限控制 |

---

## 5. 数据模型设计

建议将普通模型配置和密钥分开存储。

### 5.1 ModelProfile

表示一个模型配置档案。

```ts
export interface ModelProfile {
  id: string;
  name: string;

  provider: string;
  baseUrl: string;
  model: string;

  credentialRef: string | null;

  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastValidatedAt: string | null;
  validationStatus:
    | "unconfigured"
    | "pending"
    | "valid"
    | "invalid"
    | "unknown";
}
```

说明：

- `id`：配置档案 ID。
- `name`：用户可识别的配置名称。
- `provider`：供应商标识。
- `baseUrl`：接口地址。
- `model`：模型名称。
- `credentialRef`：后端内部使用的密钥引用，不是密钥本身。
- `validationStatus`：最近一次验证状态，不保证当前密钥一定仍然有效。

`credentialRef` 不应被当作授权令牌暴露给客户端。对前端只返回必要的配置字段。

### 5.2 密钥存储结构

密钥实际存储在 `CredentialStore` 中。

逻辑结构可以是：

```ts
interface StoredCredential {
  profileId: string;
  apiKey: string;
  updatedAt: string;
}
```

这只是后端内部的数据结构，不应作为 API 响应返回。

### 5.3 活动配置

如果用户只需要一个默认模型，可以额外保存：

```ts
interface ModelSettings {
  activeProfileId: string | null;
}
```

后续支持不同任务选择不同模型时，可以扩展为：

- 默认解题模型。
- 讨论模型。
- OCR / 视觉模型。
- 归档整理模型。

第一版不需要提前实现复杂的自动路由。

---

## 6. 后端服务设计

建议新增以下服务：

```text
ModelConfigService
CredentialStore
ModelProviderRegistry
ModelConnectionValidator
```

### 6.1 ModelConfigService

负责：

- 查询脱敏配置。
- 新建、修改和删除模型档案。
- 保存或替换 API Key。
- 切换活动模型。
- 检查配置完整性。
- 返回模型配置状态。

业务服务不得绕过 `CredentialStore` 直接读取密钥文件。

### 6.2 CredentialStore

负责：

- 保存密钥。
- 读取密钥。
- 更新密钥。
- 删除密钥。
- 检查指定密钥是否存在。
- 处理存储不可用或解密失败等错误。

不负责调用模型 API，也不负责管理前端 UI。

### 6.3 ModelProviderRegistry

负责根据 `provider` 创建正确的模型客户端，并统一处理：

- API 地址。
- 鉴权方式。
- 模型名称。
- 请求格式。
- 超时。
- 错误分类。
- 视觉能力与多模态请求。

具体模型调用时，从 `CredentialStore` 读取密钥，完成请求后不再长期保留额外副本。

### 6.4 ModelConnectionValidator

负责验证模型配置。

验证流程：

1. 检查供应商、模型和接口地址是否填写。
2. 检查 API Key 是否已保存，或本次请求是否提供了待验证的新 Key。
3. 发起轻量、受限的验证请求。
4. 返回可用、认证失败、模型不存在、额度不足、网络错误等结果。
5. 仅在验证成功后更新最近验证时间和状态。

不能将网络超时简单判定为 API Key 错误。

---

## 7. API 接口设计

以下是建议接口，可按项目现有路由风格调整。

### 7.1 获取模型配置

```http
GET /api/model-profiles
```

响应示例：

```json
{
  "activeProfileId": "profile-001",
  "profiles": [
    {
      "id": "profile-001",
      "name": "默认模型",
      "provider": "openai-compatible",
      "baseUrl": "https://api.example.com/v1",
      "model": "example-model",
      "credentialConfigured": true,
      "validationStatus": "valid",
      "lastValidatedAt": "2026-10-27T10:00:00Z"
    }
  ]
}
```

注意：示例中的供应商、地址和模型名均为占位值。

响应中不应包含：

- API Key 明文。
- 密钥文件路径。
- 加密密钥。
- 可直接用于读取密钥的内部凭据引用。

### 7.2 新增配置

```http
POST /api/model-profiles
Content-Type: application/json
```

请求示例：

```json
{
  "name": "默认模型",
  "provider": "openai-compatible",
  "baseUrl": "https://api.example.com/v1",
  "model": "example-model",
  "apiKey": "用户输入的密钥"
}
```

后端处理：

1. 验证请求参数。
2. 校验供应商和 URL。
3. 将 API Key 写入安全存储。
4. 保存不含密钥的普通配置。
5. 根据产品流程验证连接。
6. 返回脱敏后的配置状态。

密钥不能写入请求日志或异常日志。生产环境中，应避免记录整个请求体。

### 7.3 更新配置

```http
PATCH /api/model-profiles/{id}
Content-Type: application/json
```

示例：

```json
{
  "name": "备用模型",
  "model": "another-model"
}
```

如果没有提供 `apiKey` 字段，则保留已保存的密钥。

如果用户主动替换密钥，后端才更新凭据存储。

**不要将空字符串自动解释为覆盖现有密钥。** 密钥删除应使用单独、明确的操作。

### 7.4 替换 API Key

```http
PUT /api/model-profiles/{id}/credential
Content-Type: application/json
```

示例：

```json
{
  "apiKey": "新的密钥"
}
```

处理成功后，响应只返回：

```json
{
  "credentialConfigured": true,
  "validationStatus": "pending"
}
```

如果产品选择“先验证后替换”，应先使用新密钥进行验证，成功后再原子性地替换旧密钥。

### 7.5 验证连接

```http
POST /api/model-profiles/{id}/validate
```

响应示例：

```json
{
  "success": true,
  "status": "valid",
  "message": "连接验证成功"
}
```

如果供应商没有专门的模型列表或健康检查接口，可以使用受限的轻量请求。验证成本、请求方式和权限要求应按供应商能力决定。

### 7.6 切换活动模型

```http
PUT /api/model-settings/active-profile
Content-Type: application/json
```

```json
{
  "profileId": "profile-001"
}
```

后端检查配置是否存在、是否启用，然后保存活动配置 ID。

### 7.7 删除密钥

```http
DELETE /api/model-profiles/{id}/credential
```

删除密钥后：

- 保留模型档案中的供应商和模型信息。
- 将 `credentialConfigured` 设为 `false`。
- 将验证状态设为 `unconfigured`。
- 后续调用模型时返回清晰的配置缺失错误。

### 7.8 删除模型档案

```http
DELETE /api/model-profiles/{id}
```

删除前检查它是否为活动配置。

如果是活动配置，要求用户先切换到其他配置，或者通过明确的操作同时清除活动配置引用。

删除档案时，清理其关联密钥，避免产生无人管理的凭据。

---

## 8. 前端交互设计

### 8.1 首次配置

用户首次进入模型设置页面：

1. 显示供应商、Base URL、模型名称和 API Key 输入框。
2. 用户填写后点击保存。
3. 显示保存状态。
4. 连接验证完成后显示结果。
5. 后续进入设置页面时自动读取脱敏配置。

### 8.2 已保存配置

页面只显示：

- 供应商。
- 模型名称。
- Base URL。
- 密钥是否已配置。
- 最近验证状态。
- 最近验证时间。
- 更换密钥。
- 验证连接。
- 删除密钥。
- 删除配置。

API Key 输入框默认不回显已保存的明文密钥。

如果需要修改，用户主动选择“更换 API Key”，然后输入新密钥。

### 8.3 加载流程

```text
打开应用
   ↓
前端请求 GET /api/model-profiles
   ↓
后端读取普通配置与凭据存在状态
   ↓
返回脱敏配置
   ↓
前端展示当前活动模型
   ↓
发起 AI 请求时由后端读取 API Key
```

不需要在每次页面加载时把 API Key 传回前端。

### 8.4 状态设计

建议统一以下状态：

- 未配置。
- 已保存，待验证。
- 验证中。
- 连接正常。
- 认证失败。
- 模型不可用。
- 额度或余额不足。
- 网络异常。
- 凭据存储不可用。

用户需要知道下一步该做什么，而不仅仅看到“请求失败”。

---

## 9. 安全要求

### 9.1 禁止事项

- 不将 API Key 保存到 `localStorage` 或 `sessionStorage`。
- 不把 API Key 放入 URL、二维码、前端路由参数或普通配置导出文件。
- 不在日志、异常堆栈和遥测数据中记录密钥。
- 不通过普通配置查询接口返回密钥明文。
- 不允许任何局域网设备仅凭知道服务器地址就调用模型接口。
- 不将所有请求默认视为来自可信局域网。
- 不在生产环境中使用宽松的跨源访问配置。

### 9.2 本地服务的访问控制

对于电脑端启动、手机扫码加入的模式：

1. 服务启动时生成独立的工作区配对令牌。
2. 二维码只包含加入工作区所需的信息，不包含 API Key。
3. 配对令牌应具有过期时间，并支持撤销或重新生成。
4. 手机加入时验证配对令牌，必要时要求电脑端确认。
5. 配对成功后建立受控的会话凭证。
6. 会话凭证应具备合理的有效期和权限范围。
7. 修改模型配置、替换密钥等敏感操作应要求更高权限，必要时只允许在主机端执行。

不要直接把长期有效的主机管理令牌放进二维码。二维码被截屏或转发后，长期令牌可能造成未授权访问。

### 9.3 网络与 URL 安全

- 校验 `baseUrl`，仅允许受支持的协议和地址。
- 如果支持用户自定义 API 地址，防范 SSRF，特别是访问云元数据地址、环回地址和不应访问的内网服务。
- 不允许任意客户端通过配置接口让后端请求任意 URL。
- 生产或远程部署时使用 HTTPS。
- 局域网部署也应评估网络中的其他设备能否窃听或伪造请求。

### 9.4 运行时保护

- 尽量缩短密钥在内存中的存活时间。
- 不把 API Key 缓存到前端状态管理器。
- 不将密钥放入前端错误报告。
- 进程崩溃、调试输出或请求追踪时，避免泄露敏感变量。
- 明确系统凭据库不可用时的处理方式，不能静默降级到明文存储。

---

## 10. Local-first 数据与配置边界

建议将数据分为三类：

### 10.1 业务数据

例如：

- 题目与分组。
- 解题步骤。
- 讨论消息。
- 图片资源。
- AI 生成记录。

按照现有 Local-first 数据方案保存。

### 10.2 普通模型配置

例如：

- 供应商。
- Base URL。
- 模型名称。
- 活动配置 ID。
- 生成参数。

可以保存到现有配置数据库或普通配置文件中。

### 10.3 敏感凭据

例如：

- API Key。
- 供应商访问令牌。
- 其他模型服务凭据。

单独交由 `CredentialStore` 管理，不直接混入业务数据库。

如果未来支持多用户，每个用户的凭据必须独立授权和隔离，不能因为多个用户连接到同一台主机就共享管理权限。

---

## 11. 异常处理

| 场景 | 后端行为 | 前端反馈 |
|---|---|---|
| 首次未配置密钥 | 返回未配置状态 | 引导用户配置 |
| 密钥无效 | 返回认证错误分类 | 提示更换或检查密钥 |
| 网络超时 | 保留原配置 | 提示检查网络 |
| 模型不存在 | 保留原配置 | 提示检查模型名称 |
| 额度不足 | 保留原配置 | 提示检查供应商额度 |
| 安全存储不可用 | 阻止不安全写入 | 提示修复存储或选择明确的降级方案 |
| 密钥解密失败 | 不尝试使用损坏数据 | 提示重新配置密钥 |
| 删除密钥失败 | 不谎报成功 | 提示操作失败 |
| 进程重启 | 重新读取配置和凭据 | 自动恢复使用状态 |

不要在遇到临时网络错误时自动删除用户密钥，也不要把所有供应商错误都归类为“Key 错误”。

---

## 12. 测试计划

### 功能测试

- [ ] 首次配置 API Key 后可以调用模型。
- [ ] 关闭并重新启动后端，配置仍然存在。
- [ ] 刷新前端后不需要重新输入 API Key。
- [ ] 修改模型名称不会意外删除 API Key。
- [ ] 替换 API Key 后使用新密钥调用模型。
- [ ] 删除 API Key 后模型请求被正确阻止。
- [ ] 切换活动模型后后端使用正确配置。
- [ ] 多个模型配置可以独立管理。
- [ ] 后端异常退出后可以恢复普通配置与密钥。
- [ ] 系统凭据库不可用时，程序不会静默写入明文密钥。

### 安全测试

- [ ] `GET /api/model-profiles` 不返回 API Key。
- [ ] 前端网络响应中不包含已保存的 API Key。
- [ ] 日志中不出现 API Key。
- [ ] URL 和二维码中不包含 API Key。
- [ ] 未配对设备无法调用模型接口。
- [ ] 未授权设备无法修改或删除模型配置。
- [ ] 配对令牌过期或撤销后无法继续加入。
- [ ] 用户自定义 Base URL 经过校验。
- [ ] 错误提示不泄露密钥、凭据文件路径或内部敏感数据。

---

## 13. 分阶段实施

### P0：完成持久化闭环（本轮实施；对齐 0.1 现状：普通配置已持久化，补齐密钥）

- [x] 创建 `CredentialStore` 抽象。
- [x] 实现适合当前操作系统的安全存储适配器（Windows DPAPI / macOS Keychain / Linux secret-tool；均不可用时本机加密文件并显式降级，绝不静默明文）。
- [x] 将 API Key 从普通模型配置中分离（密钥只进凭据存储，sqlite 仍只存非敏感配置）。
- [x] 实现模型配置查询、保存、替换和删除接口（沿用现有 `/api/settings/provider` 单配置；多 profile 归 P1）。
- [x] 实现脱敏配置响应（`hasApiKey` + `credentialStorage` + `credentialIssue`，无明文、无路径）。
- [x] 前端增加已保存状态与更换密钥入口（已有，本轮补充存储方式展示、异常警示与文案修正）。
- [x] 验证重启后可以继续调用模型（启动 `restore()` + 集成测试覆盖「重启恢复」「删除后失效」「响应无明文」）。

### P1：完善模型管理

- [ ] 支持多个模型配置档案。
- [ ] 支持活动模型切换。
- [ ] 实现连接验证。
- [ ] 增加明确的错误分类。
- [ ] 完善配置删除和密钥轮换流程。

### P2：完善局域网安全

- [ ] 工作区配对令牌与 API Key 完全分离。
- [ ] 实现设备配对和撤销。
- [ ] 对敏感管理接口增加权限控制。
- [ ] 检查跨源请求与 CSRF 风险。
- [ ] 限制自定义模型地址。
- [ ] 验证二维码泄露不会导致模型密钥泄露。

---

## 14. 验收标准

完成后应满足：

1. 用户只需首次配置一次 API Key。
2. 重启后端和刷新页面后，已保存配置仍然可用。
3. 前端能够显示密钥已配置，但无法读取密钥明文。
4. 后端调用模型时自动使用正确的密钥。
5. 用户可以安全替换和删除密钥。
6. 模型配置与题目等业务数据保持清晰边界。
7. 手机通过局域网扫码加入时，不需要接触供应商 API Key。
8. 未授权设备不能随意调用模型或管理密钥。
9. 存储失败时有明确反馈，不会静默降级到明文存储。
10. 日志、URL、二维码和普通配置导出均不包含 API Key。

---

## 15. 最终推荐

Motive Studio 当前应采用：

- 后端统一负责模型调用。
- `ModelConfigService` 管理普通配置。
- `CredentialStore` 专门管理敏感凭据。
- 优先使用操作系统凭据库。
- 无法使用系统凭据库时，使用有明确密钥保护机制的加密存储。
- 前端只读取脱敏配置与凭据存在状态。
- 局域网配对凭证和模型 API Key 完全分离。

第一版不需要急于实现复杂的云端密钥管理系统。先把本地单用户的持久化、安全存储、自动加载和局域网权限边界做好，再扩展多用户和多模型能力。
