Add-Type -AssemblyName System.Drawing

$src = "C:\Users\malaca\.gemini\antigravity-ide\brain\a58d36b6-cc37-46a1-b63a-f377c029cb40\.user_uploaded\media_1790482130472.png"
$targetDir = "d:\dev\web\7MGFC\public"

Copy-Item $src "$targetDir\logo.png" -Force

$img = [System.Drawing.Image]::FromFile($src)

function Resize-Img($orig, $w, $h, $dest) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($orig, 0, 0, $w, $h)
    $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

Resize-Img $img 128 128 "$targetDir\icons\icon128.png"
Resize-Img $img 48 48 "$targetDir\icons\icon48.png"
Resize-Img $img 16 16 "$targetDir\icons\icon16.png"

$img.Dispose()
Write-Output "Successfully generated logo.png, icon128.png, icon48.png, icon16.png"
