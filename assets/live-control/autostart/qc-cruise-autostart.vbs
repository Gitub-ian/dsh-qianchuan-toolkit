' Qianchuan cruise autostart (login) - shipped with dsh-qianchuan-toolkit
' Requires QC_BASE = the plugin checkout root that contains assets\live-control\scripts\start-qc.cmd
' 1) open the debug Chrome (port 9222)  2) wait for the port  3) start the cruise supervisor
Dim sh, fso, base, startupCmd, cruiseCmd, delayMs, env
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set env = sh.Environment("PROCESS")
base = env("QC_BASE")
If Len(base) = 0 Then WScript.Quit 9
startupCmd = base & "\assets\live-control\scripts\start-qc.cmd"
cruiseCmd = base & "\assets\live-control\autostart\start-cruise.cmd"

delayMs = 45000
If Len(env("QC_START_DELAY")) > 0 Then delayMs = CLng(env("QC_START_DELAY")) * 1000
If delayMs > 0 Then WScript.Sleep delayMs

If Not fso.FileExists(startupCmd) Then WScript.Quit 1
If Not fso.FileExists(cruiseCmd) Then WScript.Quit 2

If Not CdpUp() Then sh.Run "cmd /c """ & startupCmd & """", 0, False
If Not WaitCdp(180) Then
  sh.Run "cmd /c """ & cruiseCmd & """", 0, False
  WScript.Quit 3
End If
sh.Run "cmd /c """ & cruiseCmd & """", 0, False

Function CdpUp()
  Dim xhr
  CdpUp = False
  On Error Resume Next
  Set xhr = CreateObject("MSXML2.XMLHTTP")
  xhr.Open "GET", "http://127.0.0.1:9222/json/version", False
  xhr.Send
  If Err.Number = 0 And xhr.Status = 200 Then CdpUp = True
  Err.Clear
  On Error GoTo 0
End Function

Function WaitCdp(seconds)
  Dim t0
  t0 = Now
  Do
    If CdpUp() Then
      WaitCdp = True
      Exit Function
    End If
    WScript.Sleep 3000
  Loop While DateDiff("s", t0, Now) < seconds
  WaitCdp = False
End Function
