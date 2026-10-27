# Motive Studio — Focus Teal 主题系统实施计划

> 来源：用户提供的配色方案与主题实施 Prompt。
> 配套文档：PRODUCT_SPEC.md（产品规格）、.agent/ui-ux-plan.md（UI/UX 计划）、.agent/prompts/（4 个生产 Prompt）。

请为现有 Motive Studio 实现统一的 Focus Teal 主题系统，支持日间模式、夜间模式和跟随系统三种外观。

## 一、实施原则

1. 先检查现有项目技术栈、组件结构、样式组织和主题实现方式。
2. 在现有代码基础上增量修改，不重建页面，不改变既有三栏布局、业务流程、数据模型、消息 Tag 机制、归档逻辑或 AI 调用逻辑。
3. 优先使用 CSS Variables、现有主题机制或项目已经采用的设计系统，建立统一的语义化颜色 Token。
4. 不要仅通过全局反色或简单替换背景色实现暗色模式。
5. 保持专业、克制、现代、适合长时间阅读与思考的产品视觉。

## 二、品牌主题：Focus Teal

### 日间模式

```css
--color-brand-deep: #173C3B;
--color-brand-primary: #0D9488;
--color-brand-hover: #0B7F75;
--color-brand-soft: #5CC7B6;
--color-selection-bg: #E5F6F2;
--color-page-bg: #F7FAF9;
--color-sidebar-bg: #F0F5F3;
--color-panel-bg: #FFFFFF;
--color-overlay-bg: #FFFFFF;
--color-input-bg: #FFFFFF;
--color-text-primary: #202A28;
--color-text-secondary: #64716D;
--color-text-muted: #8A9691;
--color-border: #DDE7E3;
--color-disabled: #B8C5C0;
```

### 夜间模式

```css
--color-brand-deep: #102927;
--color-brand-primary: #2DD4BF;
--color-brand-hover: #5EEAD4;
--color-brand-soft: #5EEAD4;
--color-selection-bg: #173C38;
--color-page-bg: #111817;
--color-sidebar-bg: #151F1D;
--color-panel-bg: #192321;
--color-overlay-bg: #202D2A;
--color-input-bg: #151F1D;
--color-text-primary: #E5EFEC;
--color-text-secondary: #A0B0AA;
--color-text-muted: #74857F;
--color-border: #2D3D38;
--color-disabled: #43534D;
```

以上颜色应当作为基础参考。检查实际文字与背景的对比度，必要时对辅助色进行微调，确保可读性和交互状态的辨识度。

## 三、主题切换机制

实现三种模式：

* Light：始终使用日间模式。
* Dark：始终使用夜间模式。
* System：跟随操作系统外观设置。

要求：

1. 主题切换应通过统一的主题状态和语义化 Token 生效。
2. 如果项目已有设置持久化机制，复用它保存用户选择；不要额外引入不必要的状态管理依赖。
3. 系统主题变化时，System 模式应自动响应。
4. 避免首次渲染时明显闪烁或先显示错误主题。
5. 主题切换不能重置当前选中的题目、分组、聊天内容或其他业务状态。

## 四、三栏界面的主题适配

### 左栏：分组与题目导航

* 使用中性背景，不要整栏铺设品牌色。
* 当前选中的题目、分组或导航项使用低饱和度的品牌背景。
* Hover、Focus、Selected、Disabled 状态必须清晰区分。
* 保证图标、文字和分隔线在两种模式下都清晰可辨。

### 中栏：正式答案与结构化内容

* 将其作为主要阅读区域，优先保证文字、公式、步骤和长内容的可读性。
* 正文使用主文字颜色，辅助说明使用次级文字颜色。
* 当前步骤的强调采用细边框、局部底色或小面积品牌色。
* 适配 Markdown、代码块、表格、引用块、数学公式、列表和链接。
* 避免大面积高饱和背景及不必要的渐变。

### 右栏：ChatBox 自由讨论区

* 区分用户消息、AI 消息和系统状态，但不要依赖颜色作为唯一识别方式。
* 输入框、发送按钮、附件入口、消息操作菜单均应适配两种模式。
* 聚焦输入框时显示清晰但克制的品牌色 Focus Ring。
* 加载、失败、重试、空状态和归档状态都要有对应样式。
* 不要求用户手动填写或选择 Tag，不要改变现有自动分类和归档行为。

## 五、组件状态和细节

全面检查并适配：

* Button：Primary、Secondary、Ghost、Danger、Disabled。
* Input、Textarea、Select、Checkbox、Radio。
* Tooltip、Popover、Dropdown、Dialog、Modal。
* Tabs、Navigation、Accordion、Menu。
* Toast、Alert、Loading、Skeleton、Empty State。
* Hover、Focus、Active、Selected、Disabled、Error。
* Markdown、代码高亮、表格、公式、滚动条、分割线。

不要把所有成功、归档或选中状态都涂成品牌色。警告、错误、成功等语义状态应保留独立配色，并确保夜间模式下依然可辨认。

## 六、视觉约束

* 不要使用纯黑作为大面积页面背景。
* 不要让所有卡片都拥有明显描边、阴影或圆角容器。
* 不要在夜间模式中直接复用日间模式的浅色背景。
* 不要大面积使用青绿色文字或青绿色面板。
* 避免无意义的渐变、霓虹发光、玻璃拟态和过多动画。
* 保持清晰的层级、适度留白、稳定的三栏结构和一致的间距体系。
* 如果项目已有设计 Token、组件库或图标体系，优先沿用，不要重复造一套。

## 七、验收标准

1. Light、Dark、System 三种模式均可正常工作。
2. 刷新页面后主题选择符合项目现有持久化策略。
3. 切换主题不影响任何业务状态和数据。
4. 三栏布局、聊天、正式答案、步骤入口、归档和其他原有功能继续正常工作。
5. 所有主要页面和交互组件在两种模式下均无明显低对比度、错误背景或遗留硬编码颜色。
6. 代码结构清晰，主题颜色集中管理，避免重复散落的颜色常量。
7. 完成后列出修改文件、主题切换实现方式、测试结果，以及仍未覆盖的组件或页面。

先检查项目，再按现有架构实施。不要只输出设计建议或伪代码，直接完成实际代码修改，并运行项目现有的相关检查。
