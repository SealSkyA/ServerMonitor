# Requirements Document

## Introduction

双面板文件管理功能允许用户在两个独立的服务器目录之间查看和复制文件，同时保留现有文件管理能力。

## Glossary

- **左侧面板**: 保留完整文件管理能力的主文件区。
- **右侧面板**: 用于选择目标服务器和目标目录的第二文件区。
- **跨面板复制**: 将一个面板中的单个文件写入另一面板当前目录的操作。

## Requirements

### Requirement 1: 双面板目录浏览

**User Story:** AS 运维用户, I want 同时查看两个服务器目录, so that 我可以选择文件来源与目标位置。

#### Acceptance Criteria

1. WHEN 文件页面加载，系统 SHALL 显示左侧面板和右侧面板。
2. WHEN 用户为右侧面板选择已连接服务器，系统 SHALL 加载该服务器的根目录。
3. WHEN 用户在任一面板输入绝对路径、相对路径或 `cd` 命令，系统 SHALL 打开解析后的目录。
4. WHILE 两个面板选择同一服务器，系统 SHALL 为每个面板维护独立的当前目录。

### Requirement 2: 文件复制

**User Story:** AS 运维用户, I want 在两个面板间复制文件, so that 我可以在服务器目录间传送文件。

#### Acceptance Criteria

1. WHEN 用户点击文件的复制操作，系统 SHALL 将文件复制到另一面板的当前目录。
2. WHILE 源与目标面板连接不同服务器，系统 SHALL 通过应用设备上的 SSH 连接转发文件内容。
3. WHEN 复制完成，系统 SHALL 刷新目标面板的文件列表并显示结果提示。
4. IF 源连接、目标连接或目标目录写入失败，系统 SHALL 显示失败提示。

### Requirement 3: 既有功能保留

**User Story:** AS 运维用户, I want 保留现有文件工具, so that 双面板浏览不影响现有工作流。

#### Acceptance Criteria

1. WHILE 使用左侧面板，系统 SHALL 提供现有的新建、上传、下载、编辑、重命名、删除和传输任务功能。
2. WHEN 文件列表显示内容，系统 SHALL 将目录排在普通文件之前并按名称排序。

### Requirement 4: 顶栏服务器与文件工具

**User Story:** AS 运维用户, I want 在文件页顶栏管理服务器和目录工具, so that 我可以在当前工作区快速完成目录操作。

#### Acceptance Criteria

1. WHEN 用户打开左侧菜单，系统 SHALL 显示可搜索的服务器列表和每个服务器的连接状态。
2. WHEN 用户选择服务器，系统 SHALL 将服务器分配到当前可用工作区并加载服务器首页目录。
3. WHEN 用户点击顶栏目录信息，系统 SHALL 接收绝对路径或相对路径并打开存在的目录。
4. WHEN 用户打开文件工具菜单，系统 SHALL 提供刷新、当前目录搜索、全选、排序、隐藏文件显示、终端跳转、命名书签、首页目录设置和服务器退出操作。
5. WHEN 用户保存命名书签或服务器首页目录，系统 SHALL 在应用重启后恢复对应数据。

### Requirement 5: 文件工具浮层与排序

**User Story:** AS 运维用户, I want 使用安全区内的文件工具菜单和排序设置, so that 我可以保持文件列表的查看偏好。

#### Acceptance Criteria

1. WHEN 用户打开文件工具，系统 SHALL 在顶栏下方显示右侧白色浮层菜单。
2. WHEN 用户打开排序方式，系统 SHALL 显示包含名称、日期、大小和类型的单选项。
3. WHEN 用户确认排序方式，系统 SHALL 按服务器保存排序字段和逆向排序状态。
4. WHEN 用户选择仅应用于此文件夹，系统 SHALL 按服务器和目录保存排序字段和逆向排序状态。
5. WHEN 用户执行全选，系统 SHALL 关闭文件工具浮层并以蓝色背景标记当前工作区的文件行。

### Requirement 6: 返回与搜索交互

**User Story:** AS 运维用户, I want 使用手机返回键退出当前文件操作状态, so that 我可以在文件层级中连续返回。

#### Acceptance Criteria

1. WHEN 用户点击文件工具中的搜索，系统 SHALL 显示独立的搜索输入弹窗。
2. WHEN 用户确认搜索词，系统 SHALL 在当前工作区的已加载目录内容中显示匹配文件。
3. WHEN 用户点击手机返回键且存在打开的文件弹窗或浮层，系统 SHALL 关闭最上层界面。
4. WHEN 用户点击手机返回键且存在全选状态，系统 SHALL 清除当前选择状态。
5. WHEN 用户点击手机返回键且当前目录存在父级目录，系统 SHALL 打开父级目录。
6. WHEN 用户收藏书签，系统 SHALL 提示用户填写书签别名。

### Requirement 7: 紧凑文件行与操作菜单

**User Story:** AS 运维用户, I want 使用紧凑的文件行和统一操作菜单, so that 我可以在双面板中查看更多文件并完成文件操作。

#### Acceptance Criteria

1. WHEN 文件面板显示顶部工具，系统 SHALL 显示新建文件、新建文件夹、上传文件和上传文件夹按钮。
2. WHEN 文件列表显示条目，系统 SHALL 显示图标、名称和 `YY-MM-DD HH:mm` 格式的修改时间。
3. WHEN 用户点击文件图标或长按文件行，系统 SHALL 显示文件操作菜单。
4. WHEN 用户使用文件操作菜单，系统 SHALL 提供下载、复制、移动、重命名、删除、压缩、属性和收藏书签操作。
5. WHEN 操作菜单从左侧面板打开，系统 SHALL 显示向右的复制和移动方向标记。
6. WHEN 操作菜单从右侧面板打开，系统 SHALL 显示向左的复制和移动方向标记。
7. WHEN 用户移动同一服务器中的文件或目录，系统 SHALL 执行服务器内移动。
8. WHEN 用户移动不同服务器中的单个文件，系统 SHALL 在目标服务器写入完成后删除源文件。
