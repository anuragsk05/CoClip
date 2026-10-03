use serde::{Deserialize, Serialize};
use time::MediaTime;

pub const DEFAULT_RATE: f64 = 1.0;
pub const MIN_RATE: f64 = 0.01;
pub const MAX_RATE: f64 = 5.0;

/// A clip's playback rate, expressed as source ticks consumed per timeline tick.
///
/// The rate is clamped on construction, so every `Retime` is playable and a
/// malformed rate degrades to normal speed instead of producing a clip whose
/// source span cannot be resolved.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(transparent)]
pub struct Retime {
    rate: f64,
}

impl Retime {
    pub const NONE: Self = Self { rate: DEFAULT_RATE };

    pub fn new(rate: f64) -> Self {
        Self {
            rate: clamp_rate(rate),
        }
    }

    pub fn rate(self) -> f64 {
        self.rate
    }

    pub fn is_none(self) -> bool {
        self.rate == DEFAULT_RATE
    }

    /// Source ticks consumed by `clip_span` ticks of timeline.
    pub fn source_span(self, clip_span: MediaTime) -> MediaTime {
        let span = clip_span.as_ticks() as f64 * self.rate;
        MediaTime::from_ticks(round_ticks(span).max(0))
    }

    /// Timeline ticks produced by `source_span` ticks of source.
    pub fn clip_span(self, source_span: MediaTime) -> MediaTime {
        if source_span <= MediaTime::ZERO {
            return MediaTime::ZERO;
        }
        let span = source_span.as_ticks() as f64 / self.rate;
        MediaTime::from_ticks(round_ticks(span).max(0))
    }
}

impl Default for Retime {
    fn default() -> Self {
        Self::NONE
    }
}

fn clamp_rate(rate: f64) -> f64 {
    if !rate.is_finite() || rate <= 0.0 {
        return DEFAULT_RATE;
    }
    rate.clamp(MIN_RATE, MAX_RATE)
}

/// Rounds half away from zero, matching the client's `roundMediaTime`.
fn round_ticks(ticks: f64) -> i64 {
    if !ticks.is_finite() {
        return 0;
    }
    let rounded = ticks.abs().round();
    if rounded == 0.0 {
        return 0;
    }
    let signed = if ticks < 0.0 { -rounded } else { rounded };
    signed as i64
}

#[cfg(test)]
mod tests {
    use super::{DEFAULT_RATE, MAX_RATE, MIN_RATE, Retime};
    use time::MediaTime;

    #[test]
    fn clamps_unusable_rates_to_normal_speed() {
        assert_eq!(Retime::new(f64::NAN).rate(), DEFAULT_RATE);
        assert_eq!(Retime::new(0.0).rate(), DEFAULT_RATE);
        assert_eq!(Retime::new(-2.0).rate(), DEFAULT_RATE);
    }

    #[test]
    fn clamps_rates_to_the_supported_range() {
        assert_eq!(Retime::new(0.001).rate(), MIN_RATE);
        assert_eq!(Retime::new(50.0).rate(), MAX_RATE);
    }

    #[test]
    fn converts_between_clip_and_source_spans() {
        let double = Retime::new(2.0);
        assert_eq!(
            double.source_span(MediaTime::from_ticks(1_000)),
            MediaTime::from_ticks(2_000)
        );
        assert_eq!(
            double.clip_span(MediaTime::from_ticks(2_000)),
            MediaTime::from_ticks(1_000)
        );
    }

    #[test]
    fn normal_speed_is_the_identity() {
        let span = MediaTime::from_ticks(7_919);
        assert_eq!(Retime::NONE.source_span(span), span);
        assert_eq!(Retime::NONE.clip_span(span), span);
    }
}
