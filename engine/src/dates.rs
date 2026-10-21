//! Calendar arithmetic with no timezone database and no dependencies.
//!
//! Dates are handled as proleptic Gregorian civil dates. The conversion is
//! Howard Hinnant's `days_from_civil` / `civil_from_days` pair, which is exact
//! for the whole range of `i32` years and has no leap-year special cases.

/// Days since 1970-01-01 for a civil date.
pub fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = i64::from(year) - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month = i64::from(month);
    let day = i64::from(day);
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// The civil date `days` days after 1970-01-01.
pub fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let days = days + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * shifted_month + 2) / 5 + 1) as u32;
    let month = (if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    }) as u32;
    let year = if month <= 2 { year + 1 } else { year };
    (year as i32, month, day)
}

/// The weekday name for a civil date.
pub fn weekday_name(year: i32, month: u32, day: u32) -> &'static str {
    const NAMES: [&str; 7] = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ];
    let index = (days_from_civil(year, month, day) + 4).rem_euclid(7) as usize;
    NAMES[index]
}

/// Parse `YYYY-MM-DD`, tolerating a trailing comma or full stop.
pub fn parse_date(text: &str) -> Option<(i32, u32, u32)> {
    let cleaned = text.trim_matches(|character: char| {
        character == ',' || character == '.' || character == '(' || character == ')'
    });
    let mut parts = cleaned.split('-');
    let year: i32 = parts.next()?.parse().ok()?;
    let month: u32 = parts.next()?.parse().ok()?;
    let day: u32 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some((year, month, day))
}

/// Today in UTC, without pulling in a date-time crate.
pub fn today_utc() -> (i32, u32, u32) {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0);
    civil_from_days(seconds.div_euclid(86_400))
}

#[cfg(test)]
mod tests {
    use super::{civil_from_days, days_from_civil, parse_date, weekday_name};

    #[test]
    fn epoch_is_the_origin() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(civil_from_days(0), (1970, 1, 1));
    }

    #[test]
    fn round_trips_across_leap_days() {
        for days in [-100_000_i64, -1, 0, 59, 60, 366, 20_000, 100_000] {
            let (year, month, day) = civil_from_days(days);
            assert_eq!(days_from_civil(year, month, day), days);
        }
        assert_eq!(civil_from_days(59), (1970, 3, 1));
        assert_eq!(days_from_civil(2000, 2, 29), 11_016);
    }

    #[test]
    fn knows_weekdays() {
        assert_eq!(weekday_name(2026, 10, 20), "Tuesday");
        assert_eq!(weekday_name(1969, 7, 20), "Sunday");
        assert_eq!(weekday_name(2000, 1, 1), "Saturday");
    }

    #[test]
    fn parses_iso_dates() {
        assert_eq!(parse_date("2026-10-20"), Some((2026, 10, 20)));
        assert_eq!(parse_date("2026-10-20,"), Some((2026, 10, 20)));
        assert_eq!(parse_date("2026-13-01"), None);
        assert_eq!(parse_date("tomorrow"), None);
    }
}
