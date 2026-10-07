!include WinVer.nsh

; An individual developer: no invented publisher or company registry key.
; Only the current user's application keys are touched; reading data is kept
; unless the user explicitly checks the standard NSIS delete-data option.
!macro NSIS_HOOK_PREINSTALL
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "AnimeRead 需要 Windows 10 或 Windows 11（64 位）。"
    Abort
  ${EndIf}
  !undef MANUKEY
  !undef MANUPRODUCTKEY
  !define MANUKEY "Software\AnimeRead"
  !define MANUPRODUCTKEY "${MANUKEY}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DeleteRegValue HKCU "${UNINSTKEY}" "Publisher"
!macroend

; Windows can resolve a shortcut to another location after its target is gone.
; Check ownership and remove our shortcuts while the executable still exists.
!macro ANIMEREAD_DELETE_SHORTCUT PATH
  !insertmacro IsShortcutTarget "${PATH}" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    !insertmacro UnpinShortcut "${PATH}"
    Delete "${PATH}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    !insertmacro ANIMEREAD_DELETE_SHORTCUT "$DESKTOP\${PRODUCTNAME}.lnk"
    !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder
    !insertmacro ANIMEREAD_DELETE_SHORTCUT "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
    !insertmacro ANIMEREAD_DELETE_SHORTCUT "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegKey HKCU "Software\AnimeRead"
  ${EndIf}
!macroend
