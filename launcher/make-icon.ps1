# Generates launcher/test-studio.ico (run only if you want to change the design).
Add-Type -AssemblyName System.Drawing
$sizes = 16,32,48,64,128,256
function P($x,$y) { [System.Drawing.PointF]::new([single]$x,[single]$y) }
$pngs = foreach ($n in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $n,$n
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.Clear([System.Drawing.Color]::Transparent)
  $r = [int]($n*0.22); $d = $r*2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0,0,$d,$d,180,90); $path.AddArc($n-$d-1,0,$d,$d,270,90)
  $path.AddArc($n-$d-1,$n-$d-1,$d,$d,0,90); $path.AddArc(0,$n-$d-1,$d,$d,90,90); $path.CloseFigure()
  $br = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.Point]::new(0,0)),([System.Drawing.Point]::new($n,$n)),([System.Drawing.Color]::FromArgb(37,99,235)),([System.Drawing.Color]::FromArgb(30,27,100))
  $g.FillPath($br,$path)
  # white "A" monogram
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White),([single]($n*0.11))
  $pen.StartCap='Round'; $pen.EndCap='Round'; $pen.LineJoin='Round'
  $g.DrawLines($pen,[System.Drawing.PointF[]]@((P ($n*0.22) ($n*0.80)),(P ($n*0.50) ($n*0.20)),(P ($n*0.78) ($n*0.80))))
  # green check as the crossbar
  $pen2 = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(52,211,153)),([single]($n*0.09))
  $pen2.StartCap='Round'; $pen2.EndCap='Round'; $pen2.LineJoin='Round'
  $g.DrawLines($pen2,[System.Drawing.PointF[]]@((P ($n*0.38) ($n*0.60)),(P ($n*0.47) ($n*0.69)),(P ($n*0.64) ($n*0.50))))
  $ms = New-Object System.IO.MemoryStream; $bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)
  ,$ms.ToArray()
}
$out = New-Object System.IO.MemoryStream; $w = New-Object System.IO.BinaryWriter $out
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$off = 6 + 16*$sizes.Count
for ($i=0; $i -lt $sizes.Count; $i++) {
  $n = $sizes[$i]; $b = if ($n -ge 256) {0} else {$n}
  $w.Write([byte]$b); $w.Write([byte]$b); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$pngs[$i].Length); $w.Write([uint32]$off)
  $off += $pngs[$i].Length
}
foreach ($p in $pngs) { $w.Write($p) }
[IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'test-studio.ico'), $out.ToArray())
