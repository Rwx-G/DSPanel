using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Windows.Input;

namespace DSPanel.Tests.TestHelpers;

/// <summary>
/// Validates XAML bindings against ViewModel types at compile time.
/// Parses XAML files to extract binding paths and verifies that
/// corresponding properties exist on the specified ViewModel.
/// </summary>
public static partial class XamlBindingValidator
{
    /// <summary>
    /// Extracts all binding paths from a XAML file and validates them
    /// against the specified ViewModel type.
    /// Only validates bindings outside DataTemplates (which bind to item types, not the VM).
    /// Returns a list of invalid bindings (empty if all are valid).
    /// </summary>
    public static IReadOnlyList<BindingError> ValidateBindings<TViewModel>(string xamlPath)
    {
        var xamlContent = File.ReadAllText(xamlPath);
        var bindings = ExtractBindings(xamlContent);
        var errors = new List<BindingError>();

        foreach (var binding in bindings)
        {
            // Skip bindings inside DataTemplates - they bind to the item type, not the ViewModel
            if (binding.InDataTemplate)
                continue;

            if (!IsPropertyValid<TViewModel>(binding.FullPath))
            {
                errors.Add(new BindingError(
                    binding.Path, binding.FullPath, binding.Line,
                    binding.InDataTemplate, typeof(TViewModel).Name));
            }
        }

        return errors;
    }

    /// <summary>
    /// Extracts all unique binding paths from XAML content.
    /// Handles simple bindings like {Binding PropertyName} and
    /// path bindings like {Binding Path=PropertyName}.
    /// Tracks whether each binding is inside a DataTemplate.
    /// </summary>
    public static IReadOnlyList<BindingInfo> ExtractBindings(string xamlContent)
    {
        var bindings = new List<BindingInfo>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        // Build a map of DataTemplate regions
        var templateRegions = FindDataTemplateRegions(xamlContent);

        foreach (Match match in FullBindingRegex().Matches(xamlContent))
        {
            var content = match.Groups["content"].Value;

            // Skip bindings with RelativeSource or ElementName
            if (content.Contains("RelativeSource", StringComparison.OrdinalIgnoreCase))
                continue;
            if (content.Contains("ElementName", StringComparison.OrdinalIgnoreCase))
                continue;

            var rawPath = ExtractPathFromContent(content);
            if (string.IsNullOrEmpty(rawPath))
                continue;

            var inTemplate = IsInRegion(match.Index, templateRegions);

            // Extract the root property name (before any dots for nested paths)
            var rootProperty = rawPath.Split('.')[0];

            // Use a composite key to allow same property both inside and outside templates
            var key = $"{rootProperty}:{inTemplate}";
            if (!seen.Add(key))
                continue;

            bindings.Add(new BindingInfo(
                Path: rootProperty,
                FullPath: rawPath,
                Line: GetLineNumber(xamlContent, match.Index),
                InDataTemplate: inTemplate));
        }

        return bindings;
    }

    /// <summary>
    /// Finds all DataTemplate regions (start/end character positions) in XAML.
    /// </summary>
    private static List<(int Start, int End)> FindDataTemplateRegions(string xaml)
    {
        var regions = new List<(int Start, int End)>();
        var openRegex = DataTemplateOpenRegex();
        var closeRegex = DataTemplateCloseRegex();

        var opens = openRegex.Matches(xaml).Select(m => m.Index).ToList();
        var closes = closeRegex.Matches(xaml).Select(m => m.Index).ToList();

        // Match each open with its corresponding close using a stack
        var stack = new Stack<int>();
        var events = opens.Select(i => (Index: i, IsOpen: true))
            .Concat(closes.Select(i => (Index: i, IsOpen: false)))
            .OrderBy(e => e.Index);

        foreach (var evt in events)
        {
            if (evt.IsOpen)
            {
                stack.Push(evt.Index);
            }
            else if (stack.Count > 0)
            {
                var start = stack.Pop();
                regions.Add((start, evt.Index));
            }
        }

        return regions;
    }

    private static bool IsInRegion(int position, List<(int Start, int End)> regions)
    {
        return regions.Any(r => position > r.Start && position < r.End);
    }

    private static bool IsPropertyValid<TViewModel>(string propertyPath)
    {
        var type = typeof(TViewModel);
        var parts = propertyPath.Split('.');

        // Validate the root property
        var rootProperty = parts[0];
        var propInfo = type.GetProperty(rootProperty,
            BindingFlags.Public | BindingFlags.Instance);

        if (propInfo is null)
        {
            // Check for ICommand properties generated by [RelayCommand] source generator
            if (rootProperty.EndsWith("Command", StringComparison.Ordinal))
            {
                // CommunityToolkit.Mvvm source generator creates IRelayCommand properties
                // Check all properties including those from generated partial classes
                var allProps = type.GetProperties(BindingFlags.Public | BindingFlags.Instance);
                propInfo = allProps.FirstOrDefault(p =>
                    p.Name.Equals(rootProperty, StringComparison.Ordinal) &&
                    typeof(ICommand).IsAssignableFrom(p.PropertyType));
            }

            return propInfo is not null;
        }

        // For nested paths like "SelectedUser.DisplayName", validate each level
        var currentType = propInfo.PropertyType;
        for (int i = 1; i < parts.Length; i++)
        {
            // Handle nullable types
            var underlyingType = Nullable.GetUnderlyingType(currentType) ?? currentType;
            var nestedProp = underlyingType.GetProperty(parts[i],
                BindingFlags.Public | BindingFlags.Instance);
            if (nestedProp is null)
                return false;
            currentType = nestedProp.PropertyType;
        }

        return true;
    }

    private static int GetLineNumber(string content, int charIndex)
    {
        var line = 1;
        for (int i = 0; i < charIndex && i < content.Length; i++)
        {
            if (content[i] == '\n')
                line++;
        }
        return line;
    }

    /// <summary>
    /// Matches {Binding ...} expressions and captures path and full content.
    /// Uses balancing groups to handle nested braces (e.g. converters, relative sources).
    /// </summary>
    [GeneratedRegex(
        @"\{Binding\s+(?<content>(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}",
        RegexOptions.Compiled)]
    private static partial Regex FullBindingRegex();

    /// <summary>
    /// Extracts the binding path from a binding expression content string.
    /// </summary>
    private static string? ExtractPathFromContent(string content)
    {
        content = content.Trim();
        if (string.IsNullOrEmpty(content))
            return null;

        // Check for "Path=xxx" explicitly
        var pathMatch = PathPropertyRegex().Match(content);
        if (pathMatch.Success)
            return pathMatch.Groups["path"].Value.Trim();

        // Otherwise, the first token before a comma or space+keyword is the path
        // e.g. "SearchText, Mode=TwoWay" -> "SearchText"
        var firstToken = content.Split([',', ' '], StringSplitOptions.RemoveEmptyEntries)[0];
        // If the first token contains '=' it's a named parameter, not a path
        if (firstToken.Contains('='))
            return null;

        return firstToken;
    }

    [GeneratedRegex(@"(?:^|,\s*)Path=(?<path>[^,\}]+)", RegexOptions.Compiled)]
    private static partial Regex PathPropertyRegex();

    [GeneratedRegex(@"<DataTemplate\b", RegexOptions.Compiled)]
    private static partial Regex DataTemplateOpenRegex();

    [GeneratedRegex(@"</DataTemplate>", RegexOptions.Compiled)]
    private static partial Regex DataTemplateCloseRegex();
}

/// <summary>
/// Represents a binding found in XAML.
/// </summary>
public record BindingInfo(string Path, string FullPath, int Line, bool InDataTemplate = false);

/// <summary>
/// Represents a binding error - a binding path that doesn't match the ViewModel.
/// </summary>
public record BindingError(
    string Path, string FullPath, int Line, bool InDataTemplate = false, string? ViewModelType = null)
    : BindingInfo(Path, FullPath, Line, InDataTemplate)
{
    public override string ToString() =>
        $"Line {Line}: '{FullPath}' not found on {ViewModelType}";
}
