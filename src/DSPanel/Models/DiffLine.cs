namespace DSPanel.Models;

public enum DiffLineType { Unchanged, Added, Removed }

public sealed record DiffLine(DiffLineType Type, string Content, int? OldLineNumber, int? NewLineNumber);
