# Requirements Document

## Introduction

WebDAV backup and restore lets users store Server Monitor configuration backups in a user-managed WebDAV directory.

## Glossary

- **WebDAV configuration**: The server URL, account, password, and remote directory entered by a user.
- **Backup**: A version 1 Server Monitor JSON configuration file.

## Requirements

### Requirement 1: Configure WebDAV

**User Story:** AS a Server Monitor user, I want to save WebDAV connection details, so that I can use my own remote backup storage.

#### Acceptance Criteria

1. WHEN a user opens WebDAV settings, the system SHALL present the form in the center of the screen.
2. WHEN a user requests a connection test, the system SHALL verify authenticated read and write access to the configured HTTP WebDAV directory.
3. WHEN a user saves WebDAV connection details, the system SHALL require a successful connection test for the current values.
4. WHEN a user saves valid WebDAV connection details, the system SHALL retain the details on the device.
5. WHEN a WebDAV server URL is empty or uses an unsupported protocol, the system SHALL show a validation message.

### Requirement 2: Upload Backup

**User Story:** AS a Server Monitor user, I want to upload a configuration backup to WebDAV, so that I can recover it from another device.

#### Acceptance Criteria

1. WHEN a user starts a WebDAV backup with saved settings, the system SHALL upload a version 1 configuration JSON file to the configured directory.
2. WHEN the upload completes, the system SHALL display a success message with the generated backup name.
3. IF the WebDAV server rejects the request or the network request fails, the system SHALL display the returned failure reason.

### Requirement 3: Restore Backup

**User Story:** AS a Server Monitor user, I want to select a remote WebDAV backup, so that I can restore my saved server list and theme.

#### Acceptance Criteria

1. WHEN a user opens remote recovery, the system SHALL list JSON backup files in the configured directory.
2. WHEN a user confirms a selected valid backup, the system SHALL replace the current servers and restore the saved theme.
3. IF a selected remote file has an invalid backup format, the system SHALL show a validation message.
