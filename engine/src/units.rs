//! Unit and temperature conversion.
//!
//! Factors are exact as written: 1 inch is 0.0254 m, 1 lbf-free pound is
//! 453.59237 g, and so on. Data units are decimal (1 KB = 1,000 bytes), with
//! the binary units available separately as KiB, MiB and GiB.

/// A family of units that can be converted between.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Length,
    Mass,
    Volume,
    Data,
    Speed,
    Area,
}

impl Kind {
    /// The noun used in the closing explanation.
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

/// A unit, its family and its factor to the family's base unit.
#[derive(Debug, Clone, Copy)]
pub struct Unit {
    pub kind: Kind,
    pub factor: f64,
}

/// A successful conversion.
#[derive(Debug, Clone, Copy)]
pub struct Conversion {
    pub value: f64,
    pub kind: Kind,
}

/// Look up a unit name as people type it, including plurals.
pub fn lookup(name: &str) -> Option<Unit> {
    let unit = |kind: Kind, factor: f64| Some(Unit { kind, factor });
    match name {
        "mm" => unit(Kind::Length, 0.001),
        "cm" => unit(Kind::Length, 0.01),
        "m" | "metre" | "metres" | "meter" | "meters" => unit(Kind::Length, 1.0),
        "km" | "kilometre" | "kilometres" | "kilometer" | "kilometers" => unit(Kind::Length, 1_000.0),
        "in" | "inch" | "inches" => unit(Kind::Length, 0.0254),
        "ft" | "feet" | "foot" => unit(Kind::Length, 0.3048),
        "yd" | "yard" | "yards" => unit(Kind::Length, 0.9144),
        "mi" | "mile" | "miles" => unit(Kind::Length, 1_609.344),
        "nmi" | "nautical mile" | "nautical miles" => unit(Kind::Length, 1_852.0),

        "mg" => unit(Kind::Mass, 0.001),
        "g" | "gram" | "grams" => unit(Kind::Mass, 1.0),
        "kg" | "kilogram" | "kilograms" => unit(Kind::Mass, 1_000.0),
        "t" | "tonne" | "tonnes" => unit(Kind::Mass, 1_000_000.0),
        "oz" | "ounce" | "ounces" => unit(Kind::Mass, 28.349_523_125),
        "lb" | "lbs" | "pound" | "pounds" => unit(Kind::Mass, 453.592_37),
        "stone" | "stones" | "st" => unit(Kind::Mass, 6_350.293_18),

        "ml" => unit(Kind::Volume, 0.001),
        "l" | "litre" | "litres" | "liter" | "liters" => unit(Kind::Volume, 1.0),
        "tsp" | "teaspoon" | "teaspoons" => unit(Kind::Volume, 0.004_928_921_59),
        "tbsp" | "tablespoon" | "tablespoons" => unit(Kind::Volume, 0.014_786_764_8),
        "cup" | "cups" => unit(Kind::Volume, 0.236_588_236_5),
        "pint" | "pints" => unit(Kind::Volume, 0.473_176_473),
        "qt" | "quart" | "quarts" => unit(Kind::Volume, 0.946_352_946),
        "gal" | "gallon" | "gallons" => unit(Kind::Volume, 3.785_411_784),

        "b" | "byte" | "bytes" => unit(Kind::Data, 1.0),
        "kb" => unit(Kind::Data, 1e3),
        "mb" => unit(Kind::Data, 1e6),
        "gb" => unit(Kind::Data, 1e9),
        "tb" => unit(Kind::Data, 1e12),
        "kib" => unit(Kind::Data, 1_024.0),
        "mib" => unit(Kind::Data, 1_048_576.0),
        "gib" => unit(Kind::Data, 1_073_741_824.0),

        "m/s" => unit(Kind::Speed, 1.0),
        "km/h" | "kph" => unit(Kind::Speed, 0.277_777_778),
        "mph" => unit(Kind::Speed, 0.447_04),
        "knot" | "knots" | "kn" => unit(Kind::Speed, 0.514_444_444),

        "m2" | "sqm" => unit(Kind::Area, 1.0),
        "km2" => unit(Kind::Area, 1e6),
        "ft2" | "sqft" => unit(Kind::Area, 0.092_903_04),
        "acre" | "acres" => unit(Kind::Area, 4_046.856_422_4),
        "ha" | "hectare" | "hectares" => unit(Kind::Area, 10_000.0),
        _ => None,
    }
}

/// Convert between two units of the same kind, or `None` if they differ.
pub fn convert(value: f64, from: &str, to: &str) -> Option<Conversion> {
    let source = lookup(from)?;
    let target = lookup(to)?;
    if source.kind != target.kind {
        return None;
    }
    Some(Conversion {
        value: value * source.factor / target.factor,
        kind: source.kind,
    })
}

/// Is `name` a temperature unit?
pub fn is_temperature(name: &str) -> bool {
    matches!(name, "c" | "f" | "k")
}

/// Convert a temperature between Celsius, Fahrenheit and Kelvin.
pub fn temperature(value: f64, from: &str, to: &str) -> Option<f64> {
    if !is_temperature(from) || !is_temperature(to) {
        return None;
    }
    let celsius = match from {
        "c" => value,
        "f" => (value - 32.0) * 5.0 / 9.0,
        "k" => value - 273.15,
        _ => return None,
    };
    Some(match to {
        "c" => celsius,
        "f" => celsius * 9.0 / 5.0 + 32.0,
        "k" => celsius + 273.15,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::{convert, temperature, Kind};

    #[test]
    fn converts_length() {
        let miles = convert(12.0, "km", "miles").expect("both are lengths");
        assert_eq!(miles.kind, Kind::Length);
        assert!((miles.value - 7.456_454_306_848_008).abs() < 1e-9);
    }

    #[test]
    fn converts_mass_volume_and_data() {
        assert!((convert(5.0, "kg", "lb").unwrap().value - 11.023_113_109_24).abs() < 1e-9);
        assert!((convert(2.0, "l", "ml").unwrap().value - 2_000.0).abs() < 1e-9);
        assert_eq!(convert(2.0, "gb", "mb").unwrap().value, 2_000.0);
        assert_eq!(convert(1.0, "gib", "mib").unwrap().value, 1_024.0);
    }

    #[test]
    fn refuses_cross_family_conversions() {
        assert!(convert(1.0, "km", "kg").is_none());
        assert!(convert(1.0, "km", "not-a-unit").is_none());
    }

    #[test]
    fn converts_temperatures() {
        assert!((temperature(100.0, "c", "f").unwrap() - 212.0).abs() < 1e-9);
        assert!((temperature(72.0, "f", "c").unwrap() - 22.222_222_222_222).abs() < 1e-9);
        assert!((temperature(0.0, "c", "k").unwrap() - 273.15).abs() < 1e-9);
        assert!(temperature(1.0, "c", "kg").is_none());
    }
}
