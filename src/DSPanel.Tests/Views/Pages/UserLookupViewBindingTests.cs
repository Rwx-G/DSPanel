using System.IO;
using DSPanel.Tests.TestHelpers;
using DSPanel.ViewModels;
using FluentAssertions;

namespace DSPanel.Tests.Views.Pages;

/// <summary>
/// Validates that all XAML bindings in UserLookupView.xaml
/// resolve to actual properties on UserLookupViewModel.
/// </summary>
public class UserLookupViewBindingTests
{
    private static readonly string XamlPath = Path.GetFullPath(
        Path.Combine(
            AppContext.BaseDirectory,
            "..", "..", "..", "..", "DSPanel", "Views", "Pages", "UserLookupView.xaml"));

    [Fact]
    public void AllBindings_ShouldResolveToViewModelProperties()
    {
        var errors = XamlBindingValidator.ValidateBindings<UserLookupViewModel>(XamlPath);

        errors.Should().BeEmpty(
            "all XAML bindings should match properties on UserLookupViewModel. " +
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

        // Verify critical bindings are present
        var paths = bindings.Select(b => b.Path).ToList();

        paths.Should().Contain("SearchText", "SearchBar should bind to SearchText");
        paths.Should().Contain("SearchCommand", "SearchBar should bind to SearchCommand");
        paths.Should().Contain("SearchResults", "Results list should bind to SearchResults");
        paths.Should().Contain("SelectedUser", "Results list should bind to SelectedUser");
        paths.Should().Contain("IsSearching", "Loading spinner should bind to IsSearching");
        paths.Should().Contain("HasSelectedUser", "Detail panel visibility should bind to HasSelectedUser");
        paths.Should().Contain("DetailItems", "Property grid should bind to DetailItems");
        paths.Should().Contain("UserGroups", "Groups list should bind to UserGroups");
        paths.Should().Contain("HealthStatus", "Health badge should bind to HealthStatus");
    }
}
