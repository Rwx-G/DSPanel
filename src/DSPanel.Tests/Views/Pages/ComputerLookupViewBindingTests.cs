using System.IO;
using DSPanel.Tests.TestHelpers;
using DSPanel.ViewModels;
using FluentAssertions;

namespace DSPanel.Tests.Views.Pages;

/// <summary>
/// Validates that all XAML bindings in ComputerLookupView.xaml
/// resolve to actual properties on ComputerLookupViewModel.
/// </summary>
public class ComputerLookupViewBindingTests
{
    private static readonly string XamlPath = Path.GetFullPath(
        Path.Combine(
            AppContext.BaseDirectory,
            "..", "..", "..", "..", "DSPanel", "Views", "Pages", "ComputerLookupView.xaml"));

    [Fact]
    public void AllBindings_ShouldResolveToViewModelProperties()
    {
        var errors = XamlBindingValidator.ValidateBindings<ComputerLookupViewModel>(XamlPath);

        errors.Should().BeEmpty(
            "all XAML bindings should match properties on ComputerLookupViewModel. " +
            "Invalid bindings: {0}",
            string.Join("; ", errors));
    }

    [Fact]
    public void XamlFile_ShouldExist()
    {
        File.Exists(XamlPath).Should().BeTrue(
            $"XAML file should exist at {XamlPath}");
    }

    [Fact]
    public void XamlFile_ShouldContainExpectedBindings()
    {
        var xamlContent = File.ReadAllText(XamlPath);
        var bindings = XamlBindingValidator.ExtractBindings(xamlContent);

        var paths = bindings.Select(b => b.Path).ToList();

        paths.Should().Contain("SearchText", "SearchBar should bind to SearchText");
        paths.Should().Contain("SearchCommand", "SearchBar should bind to SearchCommand");
        paths.Should().Contain("SearchResults", "Results list should bind to SearchResults");
        paths.Should().Contain("SelectedComputer", "Results list should bind to SelectedComputer");
        paths.Should().Contain("IsSearching", "Loading spinner should bind to IsSearching");
        paths.Should().Contain("HasSelectedComputer", "Detail panel visibility should bind to HasSelectedComputer");
        paths.Should().Contain("DetailItems", "Property grid should bind to DetailItems");
        paths.Should().Contain("ComputerGroups", "Groups list should bind to ComputerGroups");
        paths.Should().Contain("PingCommand", "Ping button should bind to PingCommand");
        paths.Should().Contain("DnsResolveCommand", "DNS button should bind to DnsResolveCommand");
        paths.Should().Contain("PingResult", "Ping result should bind to PingResult");
        paths.Should().Contain("DnsResult", "DNS result should bind to DnsResult");
    }
}
