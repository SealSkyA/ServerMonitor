# Requirements Document

## Introduction

文件页提供手势选择、面板目录历史和路径同步操作。

## Requirements

### Requirement 1

**User Story:** AS a server administrator, I want to select files with horizontal gestures, so that I can prepare file operations quickly.

#### Acceptance Criteria

1. WHEN a user swipes a file row right, the system SHALL add that file to the current selection.
2. WHEN a user swipes a file row left and drags across rows, the system SHALL select the inclusive file range from the starting row to the ending row.
3. WHILE a selection gesture is active, the system SHALL show horizontal movement on the affected file rows.

### Requirement 2

**User Story:** AS a server administrator, I want independent directory history for each file panel, so that I can revisit a directory after returning to its parent directory.

#### Acceptance Criteria

1. WHEN a user opens a directory, the system SHALL record the previous directory in the current panel history.
2. WHEN a user taps the forward navigation control, the system SHALL open the most recently recorded directory for the active panel.

### Requirement 3

**User Story:** AS a server administrator, I want to synchronize a directory path between panels, so that both panels can work in the same location.

#### Acceptance Criteria

1. WHEN a user taps the path synchronization control, the system SHALL open the active panel path in the other connected panel.
2. WHILE a navigation control changes directory, the system SHALL display a horizontal transition.
