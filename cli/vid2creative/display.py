"""Rich display helpers for CLI output."""
from rich.table import Table
from rich.console import Console

console = Console()


def candidates_table(result: dict) -> Table:
    """Build a Rich table showing detected action moments from a ProcessResponse."""
    table = Table(title="Detected Action Moments", show_lines=True)
    table.add_column("Time", style="cyan", width=8)
    table.add_column("Motion", style="yellow", width=8)
    table.add_column("CV Conf", style="green", width=8)
    table.add_column("Scene Cut", width=10)
    table.add_column("AI Action", width=10)
    table.add_column("Label", style="bold", min_width=14)
    table.add_column("Importance", width=10)

    for c in result.get('candidates', []):
        table.add_row(
            f"{c['timestamp']:.1f}s",
            f"{c.get('motion_score', 0):.2f}",
            f"{c.get('cv_confidence', 0):.2f}",
            "[green]✓[/green]" if c.get('nearSceneBoundary') else "—",
            "[green]✓[/green]" if c.get('isAction') else "[red]✗[/red]",
            c.get('actionLabel') or "—",
            str(c.get('importance', '—')),
        )

    return table


def timeline_table(timeline: list[dict]) -> Table:
    """Build a Rich table showing the final timeline events."""
    table = Table(title="Timeline Events (exported to creative)", show_lines=True)
    table.add_column("Appears at", style="cyan", width=10)
    table.add_column("Duration", width=9)
    table.add_column("Button text", style="bold", min_width=16)
    table.add_column("Style", width=10)
    table.add_column("Animation", width=12)

    for ev in timeline:
        cta = ev.get('cta', {})
        table.add_row(
            f"{ev.get('timestamp', 0):.1f}s",
            f"{ev.get('duration', 0.6):.1f}s",
            cta.get('text', '—'),
            cta.get('style', '—'),
            ev.get('animation', '—'),
        )

    return table
