"""
vid2creative CLI — convert gameplay videos to interactive HTML5 ad creatives.

Usage:
    vid2creative process gameplay.mp4 -o creative.html
    vid2creative analyze gameplay.mp4
    vid2creative status
"""
import json
import sys
from pathlib import Path

import typer
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TimeElapsedColumn

from .client import Vid2CreativeClient
from .config import (
    DEFAULT_API_URL, DEFAULT_WIDTH, DEFAULT_HEIGHT,
    MAX_VIDEO_SIZE_MB, SUPPORTED_EXTENSIONS,
)
from .display import candidates_table, timeline_table

app = typer.Typer(
    name="vid2creative",
    help="Convert gameplay videos to interactive HTML5 ad creatives.",
    no_args_is_help=True,
    add_completion=False,
)
console = Console()
err_console = Console(stderr=True, style="bold red")


def _validate_video(video: Path) -> None:
    if not video.exists():
        err_console.print(f"File not found: {video}")
        raise typer.Exit(1)
    if video.suffix.lower() not in SUPPORTED_EXTENSIONS:
        err_console.print(f"Unsupported format: {video.suffix}. Use: {', '.join(SUPPORTED_EXTENSIONS)}")
        raise typer.Exit(1)
    size_mb = video.stat().st_size / (1024 * 1024)
    if size_mb > MAX_VIDEO_SIZE_MB:
        err_console.print(f"Video too large: {size_mb:.1f} MB (max {MAX_VIDEO_SIZE_MB} MB)")
        raise typer.Exit(1)


@app.command()
def process(
    video: Path = typer.Argument(..., help="Path to MP4/WebM/MOV gameplay video"),
    output: Path = typer.Option(Path("creative.html"), "--output", "-o", help="Output HTML file path"),
    width: int = typer.Option(DEFAULT_WIDTH, "--width", "-w", help="Creative width in pixels"),
    height: int = typer.Option(DEFAULT_HEIGHT, "--height", "-h", help="Creative height in pixels"),
    click_url: str = typer.Option("", "--click-url", "-u", help="CTA click-through URL"),
    max_buttons: int = typer.Option(4, "--max-buttons", "-n", min=1, max=6, help="Max CTA buttons"),
    style: str = typer.Option("pulse", "--style", "-s", help="Default button style: primary|pulse|glow|glass|bounce"),
    poster_frame: int = typer.Option(0, "--poster-frame", "-p", help="Poster frame index"),
    api_url: str = typer.Option(DEFAULT_API_URL, "--api-url", help="Worker API base URL"),
    loop: bool = typer.Option(False, "--loop", help="Loop video in creative"),
    interval: float = typer.Option(1.0, "--interval", "-i", min=0.25, max=5.0, help="Frame extraction interval (seconds)"),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Show analysis details"),
):
    """
    Process a gameplay video into an interactive HTML5 ad creative.

    Full pipeline: upload → CV analysis (optical flow + scene detection) → AI labeling → HTML export.
    """
    _validate_video(video)
    size_mb = video.stat().st_size / (1024 * 1024)

    console.print(Panel(
        f"[bold]vid2creative v2.0[/bold]\n"
        f"Input:  {video.name} ({size_mb:.1f} MB)\n"
        f"Output: {output}\n"
        f"Size:   {width}×{height}px  |  Max buttons: {max_buttons}",
        title="[blue]Processing[/blue]",
        border_style="blue",
    ))

    with Vid2CreativeClient(api_url) as client:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TimeElapsedColumn(),
            console=console,
            transient=True,
        ) as progress:

            # Step 1: Upload
            t = progress.add_task("Uploading video...", total=1)
            try:
                session = client.upload(video)
            except Exception as e:
                err_console.print(f"Upload failed: {e}")
                raise typer.Exit(1)
            progress.update(t, completed=1)
            console.print(f"  [dim]Session:[/dim] [cyan]{session['sessionId']}[/cyan]")

            # Step 2: CV + AI pipeline (Container does the heavy lifting)
            t = progress.add_task("Running CV + AI pipeline...", total=1)
            try:
                result = client.process(
                    session_id=session['sessionId'],
                    max_candidates=max_buttons,
                    interval=interval,
                )
            except Exception as e:
                err_console.print(f"Processing failed: {e}")
                raise typer.Exit(1)
            progress.update(t, completed=1)

            # Step 3: Export HTML
            t = progress.add_task("Generating HTML creative...", total=1)
            try:
                html = client.export(
                    session_id=session['sessionId'],
                    config={
                        'width': width,
                        'height': height,
                        'posterFrameIndex': poster_frame,
                        'autoplayAfterTap': True,
                        'loopVideo': loop,
                        'muteByDefault': True,
                        'backgroundColor': '#000000',
                        'clickThroughUrl': click_url,
                        'timeline': result['timeline'],
                    },
                )
            except Exception as e:
                err_console.print(f"Export failed: {e}")
                raise typer.Exit(1)
            progress.update(t, completed=1)

    # Write output
    output.write_text(html, encoding='utf-8')

    # Summary
    n_buttons = len(result.get('timeline', []))
    console.print(
        f"\n[bold green]✓ Done![/bold green]  "
        f"[cyan]{result.get('totalFramesExtracted', '?')}[/cyan] frames  |  "
        f"[cyan]{result.get('sceneBoundaries', '?')}[/cyan] scene cuts  |  "
        f"[cyan]{n_buttons}[/cyan] button{'s' if n_buttons != 1 else ''}  |  "
        f"[cyan]{output.stat().st_size // 1024}[/cyan] KB"
    )
    console.print(
        f"  [dim]CV: {result.get('cvProcessingTimeMs', '?')}ms  "
        f"AI: {result.get('aiProcessingTimeMs', '?')}ms  "
        f"Total: {result.get('processingTimeMs', '?')}ms[/dim]"
    )
    console.print(f"\n  [bold]{output}[/bold]")

    if verbose:
        console.print()
        console.print(candidates_table(result))
        if result.get('timeline'):
            console.print(timeline_table(result['timeline']))


@app.command()
def analyze(
    video: Path = typer.Argument(..., help="Path to MP4/WebM/MOV gameplay video"),
    fmt: str = typer.Option("table", "--format", "-f", help="Output format: table|json"),
    api_url: str = typer.Option(DEFAULT_API_URL, "--api-url"),
    max_candidates: int = typer.Option(10, "--max-candidates", "-n", help="Max frames to analyze"),
    interval: float = typer.Option(1.0, "--interval", "-i"),
):
    """
    Analyze a video and show detected action moments without exporting.
    Useful for tuning parameters before running process.
    """
    _validate_video(video)

    with Vid2CreativeClient(api_url) as client:
        with console.status("Uploading..."):
            try:
                session = client.upload(video)
            except Exception as e:
                err_console.print(f"Upload failed: {e}")
                raise typer.Exit(1)

        with console.status(f"Analyzing {video.name} (CV + AI pipeline)..."):
            try:
                result = client.process(
                    session_id=session['sessionId'],
                    max_candidates=max_candidates,
                    interval=interval,
                )
            except Exception as e:
                err_console.print(f"Processing failed: {e}")
                raise typer.Exit(1)

    if fmt == 'json':
        # Exclude jpeg_base64 to keep output readable
        for c in result.get('candidates', []):
            c.pop('jpeg_base64', None)
        console.print_json(json.dumps(result, indent=2))
    else:
        console.print(
            f"\nExtracted [cyan]{result.get('totalFramesExtracted')}[/cyan] frames, "
            f"found [cyan]{result.get('sceneBoundaries')}[/cyan] scene cuts."
        )
        console.print(candidates_table(result))
        if result.get('timeline'):
            console.print(timeline_table(result['timeline']))


@app.command()
def status(
    api_url: str = typer.Option(DEFAULT_API_URL, "--api-url"),
):
    """Check Worker API health and Container availability."""
    with Vid2CreativeClient(api_url) as client:
        try:
            health = client.health()
        except Exception as e:
            err_console.print(f"API unreachable: {e}")
            raise typer.Exit(1)

    api_ok = health.get('status') == 'ok'
    container_status = health.get('container', 'unknown')
    container_ok = container_status == 'ok'

    console.print(Panel(
        f"API:       {'[green]ok[/green]' if api_ok else '[red]error[/red]'}\n"
        f"Version:   {health.get('version', 'unknown')}\n"
        f"Container: {'[green]' + container_status + '[/green]' if container_ok else '[yellow]' + container_status + '[/yellow]'}",
        title="[blue]vid2creative status[/blue]",
    ))

    if not api_ok or not container_ok:
        raise typer.Exit(1)
