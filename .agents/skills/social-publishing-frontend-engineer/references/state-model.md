# Suggested Frontend State Model

```text
editor
  base
  targets
  media
  dirty
  saveStatus
  validation

publish
  targets
  status
  attempts

ui
  selectedPreviewPlatform
  activePanel
  scheduleDialog
```

避免一個巨大 reactive object 負責所有內容。
