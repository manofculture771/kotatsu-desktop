Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$bmp = New-Object System.Drawing.Bitmap 256, 256
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 58; $x = 4; $y = 4; $w = 248; $h = 248
$path.AddArc($x, $y, $r, $r, 180, 90)
$path.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
$path.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90)
$path.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
$path.CloseFigure()
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 242, 71, 91))
$g.FillPath($brush, $path)

$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 11, 11, 14)), 17
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$points = @(
  (New-Object System.Drawing.PointF 74, 178),
  (New-Object System.Drawing.PointF 74, 82),
  (New-Object System.Drawing.PointF 109, 118),
  (New-Object System.Drawing.PointF 138, 62),
  (New-Object System.Drawing.PointF 167, 118),
  (New-Object System.Drawing.PointF 202, 82),
  (New-Object System.Drawing.PointF 202, 178)
)
$g.DrawLines($pen, $points)

$eye = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 11, 11, 14))
$g.FillEllipse($eye, 96, 140, 18, 18)
$g.FillEllipse($eye, 162, 140, 18, 18)

$g.Dispose()
$bmp.Save((Join-Path $root 'kotatsu.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output (Join-Path $root 'kotatsu.png')
