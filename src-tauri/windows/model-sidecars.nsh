!macro RequireModelSidecar FILE
  IfFileExists "$EXEDIR\weights\${FILE}" +3 0
  MessageBox MB_OK|MB_ICONSTOP "The bundled model file is missing:$\r$\n$EXEDIR\weights\${FILE}$\r$\n$\r$\nKeep the installer and its weights folder together, then run setup again."
  Abort
!macroend

!macro InstallModelSidecar FILE
  ClearErrors
  CopyFiles /SILENT "$EXEDIR\weights\${FILE}" "$INSTDIR\weights"
  IfErrors 0 +3
  MessageBox MB_OK|MB_ICONSTOP "Could not install the bundled model file:$\r$\n${FILE}"
  Abort
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro RequireModelSidecar "Qwen3-VL-4B-Instruct-Q4_K_M.gguf-00001-of-00002.gguf"
  !insertmacro RequireModelSidecar "Qwen3-VL-4B-Instruct-Q4_K_M.gguf-00002-of-00002.gguf"
  !insertmacro RequireModelSidecar "mmproj-F16.gguf"

  CreateDirectory "$INSTDIR\weights"
  !insertmacro InstallModelSidecar "Qwen3-VL-4B-Instruct-Q4_K_M.gguf-00001-of-00002.gguf"
  !insertmacro InstallModelSidecar "Qwen3-VL-4B-Instruct-Q4_K_M.gguf-00002-of-00002.gguf"
  !insertmacro InstallModelSidecar "mmproj-F16.gguf"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete /REBOOTOK "$INSTDIR\weights\Qwen3-VL-4B-Instruct-Q4_K_M.gguf-00001-of-00002.gguf"
  Delete /REBOOTOK "$INSTDIR\weights\Qwen3-VL-4B-Instruct-Q4_K_M.gguf-00002-of-00002.gguf"
  Delete /REBOOTOK "$INSTDIR\weights\mmproj-F16.gguf"
  RMDir /REBOOTOK "$INSTDIR\weights"
!macroend
