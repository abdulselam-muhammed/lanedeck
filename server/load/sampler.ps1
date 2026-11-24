# Read-only machine sampler: ONE long-lived PowerShell (BelowNormal priority) that prints one JSON line every N seconds.
# It never touches a process, container or runner: it only reads CIM counters.
param([int]$Interval = 5)
$ErrorActionPreference = 'SilentlyContinue'
try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch {}
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$epoch = [DateTime]::new(1970,1,1,0,0,0,[DateTimeKind]::Utc)
$k = $null; $kAt = [DateTime]::MinValue
while ($true) {
  $t0 = Get-Date
  $cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
  $os = Get-CimInstance Win32_OperatingSystem
  $disk = (Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'").PercentDiskTime
  $allWs = 0.0
  $procs = foreach ($p in (Get-CimInstance Win32_Process)) {
    $ws = [double]$p.WorkingSetSize
    $allWs += $ws
    $isNode = $p.Name -eq 'node.exe'
    if (-not $isNode -and $ws -lt 30MB) { continue }
    $cmd = $null
    if ($isNode -and $p.CommandLine) { $cmd = $p.CommandLine; if ($cmd.Length -gt 600) { $cmd = $cmd.Substring(0,600) } }
    [pscustomobject]@{
      pid = $p.ProcessId; n = $p.Name; m = [math]::Round($ws/1MB,1)
      c = [math]::Round(([double]$p.KernelModeTime + [double]$p.UserModeTime)/10000,0)
      s = if ($p.CreationDate) { [int64]([DateTime]$p.CreationDate).ToUniversalTime().Subtract($epoch).TotalSeconds } else { 0 }
      cmd = $cmd
    }
  }
  # kernel memory: the pool counters only every ~30 s (cheap CIM reads)
  if (((Get-Date) - $kAt).TotalSeconds -ge 30) {
    $m = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
    if ($m) {
      $kAt = Get-Date
      $k = [pscustomobject]@{
        pagedMB = [math]::Round([double]$m.PoolPagedBytes/1MB,0)
        nonpagedMB = [math]::Round([double]$m.PoolNonpagedBytes/1MB,0)
        uptimeS = if ($os.LastBootUpTime) { [int64]((Get-Date) - $os.LastBootUpTime).TotalSeconds } else { 0 }
      }
    }
  }
  $o = [pscustomobject]@{
    t = [int64]((Get-Date).ToUniversalTime().Subtract($epoch).TotalSeconds)
    cpu = $cpu
    ramTotalMB = [math]::Round($os.TotalVisibleMemorySize/1024,0)
    ramFreeMB = [math]::Round($os.FreePhysicalMemory/1024,0)
    disk = $disk
    procsWsMB = [math]::Round($allWs/1MB,0)
    kernel = $k
    procs = @($procs)
  }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4))
  $left = $Interval - ((Get-Date) - $t0).TotalSeconds
  Start-Sleep -Milliseconds ([int][math]::Max(1000, $left * 1000))
}
