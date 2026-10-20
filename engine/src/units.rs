//! Unit and temperature conversion.
//!
//! Factors are exact by definition (the international yard and pound
//! agreements, the 1964 litre, binary data prefixes) rather than measured, so a
//! conversion is reproducible on any machine. Data units are decimal by default
//! and binary units are spelled out (`kib`, `mib`, `gib`).

/// What a unit measures. Conversions only happen inside one kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Millimetres, metres, miles…
    Length,
    /// Milligrams, pounds, stone…
    Mass,
    /// Millilitres, cups, gallons…
    Volume,
    /// Bytes, kilobytes, mebibytes…
    Data,
    /// Metres per second, miles per hour…
    Speed,
    /// Square metres, acres, hectares…
    Area,
}

impl Kind {
    /// A short label used in answers.
    pub fn label(self) -> &'static str {
        match self {
            Kind::Length => "length",
            Kind::Mass => "mass",
            Kind::Volume => "volume",
            Kind::Data => "data",
            Kind::Speed => "speed",
            Kind::Area => "area",
        }
    }
}

/// A unit and the factor that converts it to its kind's base unit.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Unit {
    /// What the unit measures.
    pub kind: Kind,
    /// How many base units one of this unit is worth.
    pub factor: f64,
}

/// A successful conversion.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Conversion {
    /// The converted value.
    pub value: f64,
    /// The shared kind of both units.
    pub kind: Kind,
}

/// Look up a unit by the spelling a person would type.
pub fn lookup(name: &str) -> Option<Unit> {
    let key = name.trim().to_ascii_lowercase();
    let entry = match key.as_str() {
        // length → metres
        "mm" => (Kind::Length, 0.001),
        "cm" => (Kind::Length, 0.01),
        "m" | "metre" | "metres" | "meter" | "meters" => (Kind::Length, 1.0),
        "km" => (Kind::Length, 1000.0),
        "in" | "inch" | "inches" => (Kind::Length, 0.0254),
        "ft" | "feet" | "foot" => (Kind::Length, 0.3048),
        "yd" => (Kind::Length, 0.9144),
        "mi" | "mile" | "miles" => (Kind::Length, 1609.344),
        // mass → grams
        "mg" => (Kind::Mass, 0.001),
        "g" => (Kind::Mass, 1.0),
        "kg" => (Kind::Mass, 1000.0),
        "oz" => (Kind::Mass, 28.349_523_125),
        "lb" | "lbs" | "pound" | "pounds" => (Kind::Mass, 453.592_37),
        "stone" | "st" => (Kind::Mass, 6350.293_18),
        // volume → litres
        "ml" => (Kind::Volume, 0.001),
        "l" | "litre" | "litres" | "liter" | "liters" => (Kind::Volume, 1.0),
        "tsp" => (Kind::Volume, 0.004_928_921_59),
        "tbsp" => (Kind::Volume, 0.014_786_764_8),
        "cup" => (Kind::Volume, 0.236_588_236_5),
        "pint" => (Kind::Volume, 0.473_176_473),
        "qt" | "quart" => (Kind::Volume, 0.946_352_946),
        "gal" | "gallon" | "gallons" => (Kind::Volume, 3.785_411_784),
        // data → bytes
        "b" => (Kind::Data, 1.0),
        "kb" => (Kind::Data, 1e3),
        "mb" => (Kind::Data, 1e6),
        "gb" => (Kind::Data, 1e9),
        "tb" => (Kind::Data, 1e12),
        "kib" => (Kind::Data, 1024.0),
        "mib" => (Kind::Data, 1_048_576.0),
        "gib" => (Kind::Data, 1_073_741_824.0),
        // speed → metres per second
        "km/h" | "kph" => (Kind::Speed, 0.277_777_778),
        "mph" => (Kind::Speed, 0.447_04),
        "m/s" => (Kind::Speed, 1.0),
        // area → square metres
        "m2" => (Kind::Area, 1.0),
        "km2" => (Kind::Area, 1e6),
        "ft2" | "sqft" => (Kind::Area, 0.092_903_04),
        "acre" => (Kind::Area, 4046.856_422_4),
        "hectare" | "ha" => (Kind::Area, 10_000.0),
        _ => return None,
    };
    Some(Unit { kind: entry.0, factor: entry.1 })
}

/// Convert between two units of the same kind.
///
/// ```
/// let result = eltes_cai::convert(12.0, "km", "mi").unwrap();
/// assert_eq!(result.kind, eltes_cai::Kind::Length);
/// assert!((result.value - 7.456_454_306_8).abs() < 1e-9);
/// ```
pub fn convert(value: f64, from: &str, to: &str) -> Option<Conversion> {
    let source = lookup(from)?;
    let target = lookup(to)?;
    if source.kind != target.kind {
        return None;
    }
    Some(Conversion { value: value * source.factor / target.factor, kind: source.kind })
}

/// Convert a temperature between Celsius (`c`), Fahrenheit (`f`) and Kelvin (`k`).
///
/// ```
/// assert!((eltes_cai::temperature(100.0, 'c', 'f') - 212.0).abs() < 1e-9);
/// ```
pub fn temperature(value: f64, from: char, to: char) -> f64 {
    let celsius = match from {
        'c' => value,
        'f' => (value - 32.0) * 5.0 / 9.0,
        _ => value - 273.15,
    };
    match to {
        'c' => celsius,
        'f' => celsius * 9.0 / 5.0 + 32.0,
        _ => celsius + 273.15,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_inside_a_kind() {
        let miles = convert(12.0, "km", "mi").unwrap();
        assert!((miles.value - 7.456_454_306_8).abs() < 1e-9);
        let grams = convert(1.0, "lb", "g").unwrap();
        assert!((grams.value - 453.592_37).abs() < 1e-9);
        let gib = convert(1.0, "gib", "mib").unwrap();
        assert_eq!(gib.value, 1024.0);
    }

    #[test]
    fn refuses_to_cross_kinds() {
        assert!(convert(1.0, "kg", "km").is_none());
        assert!(convert(1.0, "banana", "kg").is_none());
    }

    #[test]
    fn converts_temperatures() {
        assert!((temperature(0.0, 'c', 'f') - 32.0).abs() < 1e-9);
        assert!((temperature(100.0, 'c', 'k') - 373.15).abs() < 1e-9);
        assert!((temperature(98.6, 'f', 'c') - 37.0).abs() < 1e-9);
    }
}
