
# Task 4.2.5 - Check that our sketch upload stays local

$ErrorActionPreference = "Stop"
$uploadFolder = $PSScriptRoot

# Check our own upload JavaScript and HTML files
$files = Get-ChildItem -Path $uploadFolder -File |
    Where-Object { $_.Extension -in ".js", ".html" }

# These operations could send uploaded images over the network
$blockedPatterns = @(
    '\bfetch\s*\(',
    '\bXMLHttpRequest\b',
    '\bFormData\b',
    '\bsendBeacon\s*\(',
    '\bWebSocket\s*\(',
    '\.submit\s*\(',
    '<form\b',
    '\bmethod\s*=\s*["'']?(POST|PUT)\b'
)

$problems = @()

foreach ($file in $files) {
    $matches = Select-String -Path $file.FullName -Pattern $blockedPatterns

    foreach ($match in $matches) {
        $problems += "$($file.Name):$($match.LineNumber): $($match.Line.Trim())"
    }
}

# Make sure the image is still read through a local Blob URL
$uploadCode = Get-Content (Join-Path $uploadFolder "script.js") -Raw

if ($uploadCode -notmatch 'URL\.createObjectURL\s*\(') {
    $problems += "Missing local image loading with URL.createObjectURL()."
}

# Make sure MediaPipe still processes the image inside the browser
$poseCode = Get-Content (Join-Path $uploadFolder "pose-detection.js") -Raw

if ($poseCode -notmatch 'detector\.detect\s*\(') {
    $problems += "Missing local MediaPipe pose detection."
}

if ($problems.Count -gt 0) {
    Write-Host "PRIVACY AUDIT FAILED" -ForegroundColor Red

    foreach ($problem in $problems) {
        Write-Host $problem
    }

    exit 1
}

Write-Host "PRIVACY AUDIT PASSED" -ForegroundColor Green
Write-Host "No blocked upload operations found in our upload files."
Write-Host "Local image loading and pose detection are still present."
