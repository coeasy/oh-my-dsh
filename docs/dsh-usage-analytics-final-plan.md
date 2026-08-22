# my-dsh Usage Analytics 独立插件最终方案

> 文档版本：1.0.0-final  
> 项目：my-dsh / DeepSeek Harness 客户端生态  
> 日期：2026-08-20  
> 状态：实施基线方案

## 1. 方案结论

本项目采用“独立安装插件”模式实现 Token 用量、缓存请求和多 Provider 请求分析。

插件自身拥有采集、解析、存储、统计、查询和 UI 能力，可以通过插件商城或本地插件包独立安装、启用、禁用、更新和卸载。

项目不修改上游 DeepSeek Harness。为了让插件能够实际工作，my-dsh 客户端需要提供一层稳定的 Plugin Host API，用于：

- 加载和管理插件
- 向插件提供安全的请求/Session Log 观测事件
- 提供本地存储能力
- 挂载插件 UI
- 执行权限、版本和兼容性校验

如果客户端已经具备这些能力，只需开发独立插件；如果暂时没有，则只补充客户端插件运行时和最小桥接层，不修改上游 Harness 的业务代码。

## 2. 已确定的约束

### 2.1 必须满足

- 不修改上游 DeepSeek Harness
- 统计功能作为独立插件开发
- 插件支持商城安装和本地插件包安装
- 插件支持独立启用、禁用、更新和卸载
- 首期优先支持用户自定义 Provider
- Windows、macOS、Linux、Web、VS Code 使用同一套 UI 和统计逻辑
- 费用允许显示估算值，但默认关闭
- 默认本地运行，不上传统计数据
- 不保存 Prompt、Response、API Key 或原始 Provider usage JSON
- 缺失字段显示 unknown，不转换为 0
- 插件安装后必须经过客户端真实加载、启用和使用验收

### 2.2 首期不做

- 不修改上游 Harness 源码
- 不执行用户提供的任意 JavaScript Provider 适配代码
- 不默认安装全局网络代理或 TLS 中间人代理
- 不默认联网获取汇率、价格或 Provider 账户余额
- 不把 Token 估算值伪装成真实 Token
- 不把缓存信息缺失解释为缓存未命中
- 不把本地费用估算当作 Provider 官方账单

## 3. 产品形态

### 3.1 独立插件包

建议插件 ID：

    com.my-dsh.usage-analytics

插件包采用一个包、多个入口的结构：

    usage-analytics-plugin/
    ├── manifest.json
    ├── host/
    │   └── entry.js
    ├── core/
    │   ├── normalizer.js
    │   ├── dedupe.js
    │   ├── aggregator.js
    │   └── pricing.js
    ├── providers/
    │   ├── builtin/
    │   └── custom-mappings/
    ├── storage/
    │   ├── schema.sql
    │   └── migrations/
    ├── ui/
    │   └── bundle.js
    ├── assets/
    └── tests/

其中：

- host 负责与客户端交互
- core 负责跨平台共享的统计逻辑
- providers 负责 Provider 识别和 usage 映射
- storage 负责数据库结构和迁移
- ui 是三端共用的 UI Bundle
- 平台差异只允许出现在 Host Bridge，不允许复制三套业务逻辑

### 3.2 独立生命周期

    未安装
      ↓
    已安装/未启用
      ↓
    已启用/正在采集
      ↓
    已禁用/保留数据
      ↓
    已升级或回滚
      ↓
    卸载/按用户选择保留或删除数据

插件安装不等于自动采集。插件默认安装但不启用；只有用户明确启用后，才开始接收新的 usage 事件。

## 4. 总体架构

    客户端 Plugin Host
            ↓
    安全观测桥
            ↓
    Usage 标准化
            ↓
    去重、流式合并、重试归并
            ↓
    SQLite 明细库
            ↓
    聚合与查询 API
            ↓
    共享 UI Bundle + 实时事件

### 4.1 数据来源优先级

插件采用以下数据来源优先级：

1. 客户端 Transport/请求响应观测桥
2. 现有 Session Log、SSE 或 WebSocket 事件
3. Provider 返回的标准 usage 字段
4. 用户配置的声明式 Provider 映射
5. 仅在明确允许时进行费用估算
6. 无法确认时记录为 unknown

Loopback 代理只作为后续可选兼容能力，不作为首期默认采集方式。

### 4.2 组件职责

| 组件 | 职责 | 是否跨平台共享 |
|---|---|---:|
| Plugin Manifest | 描述版本、入口、权限、目标端 | 是 |
| Host Bridge | 与客户端 Plugin Host 通信 | 否，按宿主适配 |
| Observer | 接收脱敏请求/响应或日志事件 | 由宿主提供能力 |
| Normalizer | 转换为统一 usage.v1 | 是 |
| Dedupe/Aggregator | 去重、流式合并、重试归并 | 是 |
| Storage | 保存明细和聚合数据 | 是，底层由宿主提供 |
| Query API | 向 UI 提供统一查询接口 | 是 |
| UI Bundle | 展示报表、详情、配置和状态 | 是 |

## 5. 客户端最小 Plugin Host API

插件不直接依赖 Harness 内部私有模块，只依赖稳定版本化的客户端接口。

### 5.1 必备能力

    plugin.lifecycle.v1
    plugin.permissions.v1
    plugin.observer.v1
    plugin.storage.v1
    plugin.ui.v1
    plugin.events.v1

### 5.2 Host API 逻辑接口

    interface UsagePluginHostV1 {
      getRuntimeInfo(): Promise<RuntimeInfo>;

      observeUsage(
        handler: (event: SafeObservedEvent) => void
      ): Unsubscribe;

      storage: {
        openDatabase(name: string, schemaVersion: number): Promise<Database>;
        runMigrations(): Promise<void>;
      };

      ui: {
        mount(container: unknown, options?: unknown): void;
        unmount(): void;
      };

      events: {
        subscribe(topic: string, handler: Function): Unsubscribe;
        publish(topic: string, payload: unknown): void;
      };

      permissions: {
        has(permission: string): boolean;
      };
    }

### 5.3 安全观测边界

Host 发送给插件的事件必须经过脱敏：

- 不传递 Authorization、Cookie、API Key
- 不持久化 Prompt 和 Response
- 请求/响应正文只允许在内存中短暂解析 usage 字段
- 错误只保存标准化错误类别和 HTTP 状态码
- Provider URL 只保存经过清洗的 Provider 标识或主机名
- 插件无权读取客户端任意文件
- 插件无权监听与 Provider 无关的系统网络流量

## 6. Usage 事件协议

统一事件版本：usage.event.v1。

### 6.1 标准事件字段

    {
      "schema_version": "usage.event.v1",
      "event_id": "evt_01...",
      "logical_request_id": "req_01...",
      "attempt_id": "attempt_01...",
      "session_id": "session_01...",
      "turn_id": "turn_01...",
      "provider_id": "custom-openai-compatible",
      "model_id": "model-name",
      "observed_at": "2026-08-20T12:00:00.000Z",
      "started_at": "2026-08-20T11:59:50.000Z",
      "completed_at": "2026-08-20T12:00:00.000Z",
      "status": "completed",
      "http_status": 200,
      "latency_ms": 10000,
      "input_tokens": 1000,
      "output_tokens": 500,
      "reasoning_tokens": null,
      "total_tokens": 1500,
      "cache_read_tokens": 800,
      "cache_write_tokens": 0,
      "cache_creation_tokens": 0,
      "data_quality": {
        "input_tokens": "exact",
        "output_tokens": "exact",
        "cache_read_tokens": "exact",
        "cost": "estimated"
      },
      "source": "provider_response",
      "error_category": null,
      "pricing_id": "openai-compatible-default",
      "pricing_version": "2026-08-20"
    }

### 6.2 数据质量枚举

    exact      Provider 或正式日志提供的真实值
    estimated  根据真实 Token 和本地价格计算的估算值
    derived    本地派生的关联字段
    unknown    无法获得或 Provider 不支持

质量标记必须按字段保存，不能只在事件级别保存一个总标记。

## 7. 请求、流式和重试统计口径

### 7.1 逻辑请求与网络尝试

- 一次用户发起行为对应一个 logical_request_id
- 每一次实际网络尝试对应一个 attempt_id
- 请求统计按逻辑请求计算
- 网络稳定性按 attempt 计算
- 重试请求不能重复计入最终 Token 和费用

### 7.2 流式响应

处理规则：

1. 接收开始事件，创建临时记录
2. 接收中间 chunk，只更新内存状态
3. 接收最终 usage 或完成事件后提交一次最终记录
4. 中断、超时、取消记录最终状态
5. 如果只有中间事件且没有最终 usage，不重复累加未知 Token

### 7.3 去重规则

优先使用：

    logical_request_id + attempt_id + source

没有稳定 Request ID 时，由 Host 生成本地 ID，并将关联质量标记为 derived。

## 8. Token、缓存和费用口径

### 8.1 Token 统计

支持以下字段：

- 输入 Token
- 输出 Token
- 推理 Token
- 总 Token
- 缓存读取 Token
- 缓存写入 Token
- 缓存创建 Token

Provider 不提供的字段为 unknown，不填充为 0。

### 8.2 缓存请求次数

首期同时展示：

    总逻辑请求数
    缓存读取请求数
    缓存写入请求数
    缓存创建请求数
    缓存状态未知请求数
    缓存读取 Token
    缓存写入 Token
    缓存创建 Token

建议定义：

- cache_read_requests：明确存在缓存读取字段且值大于 0 的逻辑请求
- cache_write_requests：明确存在缓存写入字段且值大于 0 的逻辑请求
- cache_creation_requests：明确存在缓存创建字段且值大于 0 的逻辑请求
- cache_status_unknown：Provider 可能支持缓存，但本次没有返回可判断字段

缓存命中率只对已知缓存数据计算，不把未知数据计入未命中。

### 8.3 费用估算

费用估算默认关闭。启用后：

- 只使用已知 Token 计算
- 价格表必须版本化
- 用户可以覆盖内置价格
- 费用字段必须标记 estimated
- 默认不联网获取汇率
- 默认不读取 Provider 官方余额
- 不将估算费用称为官方账单

推荐支持：

    USD
    CNY
    用户自定义货币显示符号

## 9. Provider 适配体系

### 9.1 首期策略

首期以“自定义 Provider 优先”为核心，采用以下组合：

- 内置常见协议模板
- Provider 标识和 Model 匹配规则
- JSON Pointer/JSONPath 字段映射
- 流式响应合并策略
- 错误字段映射
- 可视化映射测试

### 9.2 自定义映射示例

    {
      "id": "my-provider",
      "match": {
        "base_url_pattern": "api.example.com",
        "model_pattern": ".*"
      },
      "usage": {
        "input_tokens": [
          "usage.prompt_tokens",
          "usage.input_tokens"
        ],
        "output_tokens": [
          "usage.completion_tokens",
          "usage.output_tokens"
        ],
        "total_tokens": ["usage.total_tokens"],
        "cache_read_tokens": [
          "usage.prompt_tokens_details.cached_tokens"
        ],
        "cache_write_tokens": ["usage.cache_write_tokens"]
      },
      "streaming": {
        "strategy": "final_usage_preferred"
      }
    }

### 9.3 安全限制

- 不执行任意 JS
- 不允许 Provider 配置读取 API Key
- 不允许 Provider 配置发起额外联网请求
- 映射路径必须经过格式校验
- 映射失败必须产生可诊断错误
- 未识别字段显示 unknown

## 10. 本地存储设计

推荐使用插件独立 SQLite 数据库，数据库由 Host Storage API 提供跨平台访问。

### 10.1 明细表 usage_events

核心字段：

    id
    logical_request_id
    attempt_id
    session_id
    turn_id
    provider_id
    model_id
    observed_at
    started_at
    completed_at
    status
    http_status
    latency_ms
    input_tokens
    output_tokens
    reasoning_tokens
    total_tokens
    cache_read_tokens
    cache_write_tokens
    cache_creation_tokens
    cost_value
    cost_currency
    data_quality_json
    source
    error_category
    pricing_version
    created_at

禁止字段：

    prompt_raw
    response_raw
    authorization
    api_key
    cookie
    raw_provider_json

### 10.2 聚合表 usage_daily

按以下维度聚合：

    date
    provider_id
    model_id
    request_count
    attempt_count
    success_count
    error_count
    input_tokens_exact
    output_tokens_exact
    cache_read_tokens_exact
    cache_write_tokens_exact
    estimated_cost_value
    cost_currency

### 10.3 其他表

    provider_profiles
    pricing_versions
    mapping_profiles
    plugin_settings
    schema_migrations

### 10.4 保留策略

- 明细数据默认保留 181 天
- 每日聚合数据长期保留
- 用户可以立即导出、清空或暂停统计
- 清理任务后台执行，不阻塞 UI
- 删除前显示数据范围和数量

## 11. 统一查询 API

三端 UI 只依赖统一 API，不直接访问 SQLite。

建议接口：

    getOverview(range, filters)
    getDailyTrend(range, filters)
    getProviderBreakdown(range, filters)
    getModelBreakdown(range, filters)
    getCacheAnalysis(range, filters)
    getErrorAnalysis(range, filters)
    listUsageEvents(query)
    getSessionUsage(sessionId)
    getTurnUsage(turnId)
    getProviderProfile(providerId)
    exportUsage(format, query)

每个返回值都应包含：

- 数值
- 时间范围
- 筛选条件
- 数据质量说明
- 是否包含估算值
- 是否存在未知字段

实时更新通过统一事件总线或 SSE-like Host Event API 推送：

    usage.event.created
    usage.event.updated
    usage.aggregate.updated
    usage.plugin.status_changed

## 12. 共享 UI 设计

### 12.1 UI 原则

- 只维护一套 UI 逻辑
- UI 不解析 Provider 原始响应
- UI 不直接处理 API Key
- UI 明确区分 exact、estimated、unknown
- 所有图表都显示筛选范围和数据来源
- 不支持的数据不显示误导性 0

### 12.2 页面和组件

#### 总览面板

- 今日请求数
- 今日 Token
- 输入/输出 Token
- 缓存读取/写入次数
- 错误率
- P50/P95 延迟
- 估算费用，默认隐藏

#### Provider 分析

- Provider 请求量
- Model 分布
- 成功率和错误率
- 平均/P50/P95 延迟
- Token 消耗
- 缓存使用情况
- 费用估算

#### Session/Turn 详情

- 请求时间线
- 每次请求 Token
- 缓存字段
- 重试和错误
- 数据来源和质量

#### 设置

- 启用/禁用采集
- 费用估算开关
- 主货币
- Provider 映射
- 价格表
- 数据保留期
- 导出和清空数据
- 权限状态

### 12.3 三端适配

Desktop、Web、VS Code 只实现不同的 Host Bridge：

    Shared UI → Shared Query API → Host Bridge → Plugin Host

不允许为每个平台复制一套 Provider 解析、统计或费用计算逻辑。

## 13. 插件商城安装和加载方案

### 13.1 Manifest 必备字段

    {
      "id": "com.my-dsh.usage-analytics",
      "name": "Usage Analytics",
      "version": "1.0.0",
      "api_version": "plugin.host.v1",
      "targets": ["desktop", "web", "vscode"],
      "permissions": [
        "usage.observe",
        "storage.local",
        "ui.mount"
      ],
      "host_entry": "host/entry.js",
      "ui_entry": "ui/bundle.js",
      "schema_version": 1,
      "signature": "..."
    }

### 13.2 安装流程

    下载安装包
      ↓
    校验签名/checksum
      ↓
    校验目标端和 Host API 版本
      ↓
    校验权限和入口文件
      ↓
    安装到插件目录
      ↓
    注册插件
      ↓
    显示为“已安装/未启用”

### 13.3 启用流程

    用户启用
      ↓
    权限确认
      ↓
    初始化数据库和迁移
      ↓
    启动 Host Entry
      ↓
    注册观测事件
      ↓
    挂载共享 UI
      ↓
    显示插件运行状态

### 13.4 更新和回滚

- 更新前检查 Host API 兼容性
- 执行数据库备份或事务迁移
- 新版本启动失败自动回滚
- 保留上一版本入口
- 更新失败不能破坏历史数据

### 13.5 本地插件包

本地安装支持开发模式，但默认仍执行：

- Manifest 校验
- 目标端校验
- checksum 校验
- 权限确认
- 版本兼容检查

未签名插件只允许在明确开启开发模式后运行。

## 14. 权限和隐私安全

### 14.1 首期权限

    usage.observe
    storage.local
    ui.mount
    events.subscribe

默认不授予：

    network.any
    filesystem.any
    native_code
    process.spawn
    credential.read

### 14.2 数据安全

- 数据默认只保存在本地
- API Key 不进入插件存储
- Provider 正文只在内存中解析
- 数据库不保存原始 Prompt/Response
- 日志中禁止输出 Token、请求正文和密钥
- 导出文件由用户主动触发
- 导出前提示可能包含时间、Provider、Model、Session ID 等元数据

## 15. 异常和未知数据处理

统一错误分类：

    unsupported_provider
    invalid_mapping
    missing_usage
    stream_interrupted
    request_timeout
    http_error
    parse_error
    permission_denied
    storage_error
    plugin_incompatible

异常不得导致整个插件停止采集。单个 Provider 解析失败时：

1. 保留请求基本信息
2. Token 和缓存字段标记为 unknown
3. 保存标准化错误类别
4. 继续处理后续请求
5. 在设置页提供映射诊断信息

## 16. 性能要求

目标基线：

- 采集不阻塞主 UI 线程
- 事件处理采用内存队列
- SQLite 批量写入
- UI 查询默认只访问聚合表
- 明细查询必须分页
- 单次请求事件处理目标小于 10ms
- 插件异常不能影响主聊天请求
- 数据库写入失败时保留有限内存重试队列
- 队列超过上限时丢弃统计事件并显示告警，不影响主业务

## 17. 测试方案

### 17.1 单元测试

- Provider 匹配
- JSONPath/JSON Pointer 映射
- Token 字段归一化
- 缓存字段归一化
- 流式事件合并
- 请求去重
- 重试归并
- 价格计算
- unknown 传播
- 数据保留清理

### 17.2 Provider Fixture 测试

每个 Provider 至少包含：

- 普通成功响应
- 流式成功响应
- 无 usage 响应
- 缓存命中响应
- 缓存写入响应
- 错误响应
- 截断响应
- 重试响应

### 17.3 插件生命周期测试

- Marketplace 安装
- 本地安装
- 签名失败
- 目标端不兼容
- Host API 不兼容
- 安装后未启用不采集
- 启用后开始采集
- 禁用后停止采集
- 更新迁移
- 更新失败回滚
- 卸载保留数据
- 清空数据

### 17.4 多端验收

至少验证：

    Desktop Windows
    Desktop macOS
    Desktop Linux
    Web
    VS Code

每个目标端必须确认：

- 插件能被发现
- 插件能够加载 Host Entry
- UI Bundle 能挂载
- 数据库能创建和迁移
- usage 事件能进入插件
- 禁用后确实停止采集
- 卸载后主客户端仍正常运行

## 18. 分阶段实施计划

### Phase 0：插件能力审计

目标：确认现有客户端能力，不修改 Harness。

任务：

- 审计 Plugin Manifest 和加载器
- 审计 Host Entry 支持情况
- 审计 UI 挂载接口
- 审计本地存储接口
- 审计 Session Log/请求观测入口
- 确认 Desktop/Web/VS Code 的 Host API 版本

产出：

- Plugin Host Capability Matrix
- 缺口清单
- 兼容性基线

### Phase 1：独立插件骨架

任务：

- 创建插件 Manifest
- 完成安装、启用、禁用、卸载
- 完成 UI 挂载
- 完成权限确认
- 完成插件状态页

验收：插件可以独立安装，并且不启用采集。

### Phase 2：Host 观测桥和 usage.v1

任务：

- 实现安全观测事件
- 建立事件版本协议
- 实现来源和质量标记
- 实现 Session/Turn/Request 关联

验收：能接收真实客户端事件，不读取 API Key 和正文。

### Phase 3：统计 Core 和 SQLite

任务：

- 实现标准化
- 实现流式合并
- 实现去重和重试归并
- 建立数据库和迁移
- 实现 181 天清理
- 实现每日聚合

验收：同一请求不会重复计 Token、请求或费用。

### Phase 4：Provider 和自定义映射

任务：

- 实现自定义 Provider 配置
- 实现 JSONPath/JSON Pointer 映射
- 实现映射测试工具
- 添加常见协议模板

验收：用户可以在不改代码的情况下配置新的 Provider。

### Phase 5：共享 UI

任务：

- 总览面板
- Provider/Model 分析
- 缓存分析
- Session/Turn 详情
- 设置和映射诊断
- 估算费用开关

验收：三端使用同一个 UI Bundle，只有 Host Bridge 不同。

### Phase 6：商城发布和全链路验收

任务：

- 签名/checksum
- 商城安装
- 版本兼容检查
- 更新和回滚
- 多平台安装验证
- 离线和权限测试

验收：商城安装的插件可以在目标客户端真实加载、启用并采集数据。

## 19. 最终验收标准

只有同时满足以下条件，才认为插件完成：

1. 不修改上游 DeepSeek Harness
2. 插件可单独安装和卸载
3. 安装后默认不采集
4. 启用后可以接收客户端安全观测事件
5. Provider/Model/Session/Turn 关联正确
6. 流式响应不会重复计数
7. 重试不会重复计费
8. 缓存未知不会被显示为未命中
9. 自定义 Provider 不需要编写任意 JavaScript
10. Token、费用和缓存字段带有质量标识
11. 费用估算默认关闭
12. 不保存 API Key、Prompt、Response 和原始 usage JSON
13. 明细数据按默认 181 天清理
14. 三端共用同一个 UI Bundle
15. Marketplace 安装后客户端能够真实加载和使用插件
16. 插件异常不会影响主聊天功能
17. 更新失败可以回滚
18. Windows、macOS、Linux、Web、VS Code 均通过生命周期测试

## 20. 主要风险与处理结论

| 风险 | 影响 | 处理结论 |
|---|---|---|
| 没有请求/日志观测接口 | 无法获得真实 Token | Phase 0 先补齐 Host Bridge |
| Provider usage 格式不统一 | 解析失败 | 声明式映射 + unknown |
| 流式事件重复 | Token/费用双计 | 最终事件优先 + 去重 |
| Loopback 代理兼容性差 | 影响主请求 | 不作为首期主方案 |
| 插件商城只完成下载 | 插件无法运行 | 安装后执行真实加载验收 |
| 任意 JS Provider 配置 | 安全风险 | 首期禁止任意代码执行 |
| 费用价格变化 | 报表不一致 | 价格版本化 |
| 数据库迁移失败 | 历史数据损坏 | 事务迁移 + 失败回滚 |
| 插件异常阻塞聊天 | 主业务受影响 | 异步队列 + 隔离错误 |
| 未知字段被当作 0 | 数据误导 | 字段级 unknown 和质量标记 |

## 21. 方案最终决策

本项目最终采用：

    独立插件包
    + 客户端最小 Plugin Host API
    + 安全观测桥
    + usage.event.v1
    + SQLite 本地存储
    + 自定义 Provider 声明式映射
    + 三端共享 UI Bundle
    + 费用估算默认关闭
    + unknown 不等于 0
    + Marketplace 签名/兼容性/回滚
    + 181 天明细保留

该方案既满足独立安装和独立使用，也避免把统计功能耦合进上游 DeepSeek Harness。实施时唯一的前置工作是完成 Phase 0，确认客户端现有插件加载器和观测桥能力；如果能力不足，补充客户端插件运行时即可，不改变上游 Harness。

