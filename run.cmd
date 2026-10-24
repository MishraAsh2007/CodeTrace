@echo off
rem Starts the CodeTrace Python Visualizer. Wraps run.ps1 so it works even when PowerShell scripts are blocked.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
