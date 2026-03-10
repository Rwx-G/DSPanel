using System.Windows;
using System.Windows.Controls;

namespace DSPanel.Views.Controls;

/// <summary>
/// Combined date and time picker with calendar popup and hour/minute spinners.
/// </summary>
public partial class DateTimePicker : UserControl
{
    private bool _suppressUpdate;

    public static readonly DependencyProperty SelectedDateTimeProperty =
        DependencyProperty.Register(
            nameof(SelectedDateTime),
            typeof(DateTime?),
            typeof(DateTimePicker),
            new FrameworkPropertyMetadata(null,
                FrameworkPropertyMetadataOptions.BindsTwoWayByDefault,
                OnSelectedDateTimeChanged));

    public DateTime? SelectedDateTime
    {
        get => (DateTime?)GetValue(SelectedDateTimeProperty);
        set => SetValue(SelectedDateTimeProperty, value);
    }

    public DateTimePicker()
    {
        InitializeComponent();
    }

    private static void OnSelectedDateTimeChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is DateTimePicker picker && !picker._suppressUpdate)
        {
            picker.UpdateControlsFromValue();
        }
    }

    private void UpdateControlsFromValue()
    {
        _suppressUpdate = true;
        try
        {
            if (SelectedDateTime is { } dt)
            {
                PART_DatePicker.SelectedDate = dt.Date;
                PART_HourBox.Text = dt.Hour.ToString("D2");
                PART_MinuteBox.Text = dt.Minute.ToString("D2");
            }
            else
            {
                PART_DatePicker.SelectedDate = null;
                PART_HourBox.Text = "00";
                PART_MinuteBox.Text = "00";
            }
        }
        finally
        {
            _suppressUpdate = false;
        }
    }

    private void UpdateValueFromControls()
    {
        if (_suppressUpdate) return;

        _suppressUpdate = true;
        try
        {
            var date = PART_DatePicker.SelectedDate;
            if (date is null)
            {
                SelectedDateTime = null;
                return;
            }

            var hour = ParseClamp(PART_HourBox.Text, 0, 23);
            var minute = ParseClamp(PART_MinuteBox.Text, 0, 59);

            SelectedDateTime = date.Value.Date.AddHours(hour).AddMinutes(minute);
        }
        finally
        {
            _suppressUpdate = false;
        }
    }

    private void OnDateChanged(object? sender, SelectionChangedEventArgs e)
    {
        UpdateValueFromControls();
    }

    private void OnTimeTextChanged(object sender, TextChangedEventArgs e)
    {
        UpdateValueFromControls();
    }

    private void OnHourUp(object sender, RoutedEventArgs e)
    {
        var hour = ParseClamp(PART_HourBox.Text, 0, 23);
        PART_HourBox.Text = ((hour + 1) % 24).ToString("D2");
    }

    private void OnHourDown(object sender, RoutedEventArgs e)
    {
        var hour = ParseClamp(PART_HourBox.Text, 0, 23);
        PART_HourBox.Text = ((hour + 23) % 24).ToString("D2");
    }

    internal static int ParseClamp(string? text, int min, int max)
    {
        if (int.TryParse(text, out var value))
            return Math.Clamp(value, min, max);
        return min;
    }
}
