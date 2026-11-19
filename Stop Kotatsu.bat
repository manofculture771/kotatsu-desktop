@echo off
powershell -NoProfile -Command "$killed=0; 8787..8816 | ForEach-Object { $c = Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue; $killed++ } }; if ($killed -eq 0) { 'Kotatsu Desktop is not running.' } else { 'Kotatsu Desktop stopped.' }"
timeout /t 2 /nobreak >nul
