using System.IO;
using FluentAssertions;

namespace DSPanel.Tests.TestHelpers;

/// <summary>
/// Unit tests for XamlBindingValidator to ensure correct XAML parsing behavior.
/// </summary>
public class XamlBindingValidatorTests
{
    [Fact]
    public void ExtractBindings_SimpleBinding_ReturnsPath()
    {
        const string xaml = """<TextBlock Text="{Binding DisplayName}"/>""";

        var bindings = XamlBindingValidator.ExtractBindings(xaml);

        bindings.Should().ContainSingle()
            .Which.Path.Should().Be("DisplayName");
    }

    [Fact]
    public void ExtractBindings_PathSyntax_ReturnsPath()
    {
        const string xaml = """<TextBlock Text="{Binding Path=DisplayName}"/>""";

        var bindings = XamlBindingValidator.ExtractBindings(xaml);

        bindings.Should().ContainSingle()
            .Which.Path.Should().Be("DisplayName");
    }

    [Fact]
    public void ExtractBindings_BindingWithMode_ReturnsPath()
    {
        const string xaml = """<TextBox Text="{Binding SearchText, Mode=TwoWay}"/>""";

        var bindings = XamlBindingValidator.ExtractBindings(xaml);

        bindings.Should().ContainSingle()
            .Which.Path.Should().Be("SearchText");
    }

    [Fact]
    public void ExtractBindings_NestedPath_ReturnsRootAndFullPath()
    {
        const string xaml = """<TextBlock Text="{Binding SelectedUser.DisplayName}"/>""";

        var bindings = XamlBindingValidator.ExtractBindings(xaml);

        var binding = bindings.Should().ContainSingle().Subject;
        binding.Path.Should().Be("SelectedUser");
        binding.FullPath.Should().Be("SelectedUser.DisplayName");
    }

    [Fact]
    public void ExtractBindings_RelativeSourceBinding_IsExcluded()
    {
        const string xaml = """
            <TextBox Text="{Binding Text, RelativeSource={RelativeSource AncestorType=UserControl}}"/>
            """;

        var bindings = XamlBindingValidator.ExtractBindings(xaml);

        bindings.Should().BeEmpty("RelativeSource bindings should be excluded");
    }

    [Fact]
    public void ExtractBindings_RelativeSourcePathFirst_IsExcluded()
    {
        const string xaml = """
            <TextBox Text="{Binding Path=Text, RelativeSource={RelativeSource AncestorType=UserControl}}"/>
            """;

        var bindings = XamlBindingValidator.ExtractBindings(xaml);

        bindings.Should().BeEmpty("RelativeSource bindings with Path= syntax should also be excluded");
    }

    [Fact]
    public void ExtractBindings_MultipleBindings_ReturnsAllUnique()
    {
        const string xaml = """
            <Grid>
              <TextBlock Text="{Binding Name}"/>
              <TextBlock Text="{Binding Email}"/>
              <TextBlock Text="{Binding Name}"/>
            </Grid>
            """;

        var bindings = XamlBindingValidator.ExtractBindings(xaml);

        bindings.Should().HaveCount(2);
        bindings.Select(b => b.Path).Should().Contain(["Name", "Email"]);
    }

    [Fact]
    public void ExtractBindings_ConverterBinding_ReturnsPath()
    {
        const string xaml = """
            <Border Visibility="{Binding HasSelected, Converter={StaticResource BoolToVisibility}}"/>
            """;

        var bindings = XamlBindingValidator.ExtractBindings(xaml);

        bindings.Should().ContainSingle()
            .Which.Path.Should().Be("HasSelected");
    }

    [Fact]
    public void ExtractBindings_EmptyXaml_ReturnsEmpty()
    {
        const string xaml = """<Grid/>""";

        var bindings = XamlBindingValidator.ExtractBindings(xaml);

        bindings.Should().BeEmpty();
    }

    [Fact]
    public void ValidateBindings_ValidProperties_ReturnsNoErrors()
    {
        var tempFile = Path.GetTempFileName();
        try
        {
            File.WriteAllText(tempFile, """
                <Grid>
                  <TextBlock Text="{Binding Name}"/>
                  <TextBlock Text="{Binding Age}"/>
                </Grid>
                """);

            var errors = XamlBindingValidator.ValidateBindings<SampleViewModel>(tempFile);

            errors.Should().BeEmpty();
        }
        finally
        {
            File.Delete(tempFile);
        }
    }

    [Fact]
    public void ValidateBindings_InvalidProperty_ReturnsError()
    {
        var tempFile = Path.GetTempFileName();
        try
        {
            File.WriteAllText(tempFile, """
                <Grid>
                  <TextBlock Text="{Binding Name}"/>
                  <TextBlock Text="{Binding NonExistentProperty}"/>
                </Grid>
                """);

            var errors = XamlBindingValidator.ValidateBindings<SampleViewModel>(tempFile);

            errors.Should().ContainSingle()
                .Which.Path.Should().Be("NonExistentProperty");
        }
        finally
        {
            File.Delete(tempFile);
        }
    }

    [Fact]
    public void ValidateBindings_NestedProperty_ValidatesFullPath()
    {
        var tempFile = Path.GetTempFileName();
        try
        {
            File.WriteAllText(tempFile, """
                <TextBlock Text="{Binding Child.Name}"/>
                """);

            var errors = XamlBindingValidator.ValidateBindings<SampleViewModel>(tempFile);

            errors.Should().BeEmpty();
        }
        finally
        {
            File.Delete(tempFile);
        }
    }

    [Fact]
    public void ValidateBindings_InvalidNestedProperty_ReturnsError()
    {
        var tempFile = Path.GetTempFileName();
        try
        {
            File.WriteAllText(tempFile, """
                <TextBlock Text="{Binding Child.BadProp}"/>
                """);

            var errors = XamlBindingValidator.ValidateBindings<SampleViewModel>(tempFile);

            errors.Should().ContainSingle()
                .Which.Path.Should().Be("Child");
        }
        finally
        {
            File.Delete(tempFile);
        }
    }

    // Test ViewModel for validation tests
    public class SampleViewModel
    {
        public string Name { get; set; } = "";
        public int Age { get; set; }
        public SampleChild? Child { get; set; }
    }

    public class SampleChild
    {
        public string Name { get; set; } = "";
    }
}
