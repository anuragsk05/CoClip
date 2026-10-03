use serde::{Deserialize, Serialize};
use time::MediaTime;

use crate::retime::Retime;

/// Which halves of a split to keep.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RetainSide {
    Both,
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GeometryError {
    /// The split point is at or outside the clip's bounds, so one half would be empty.
    SplitOutsideClip,
    /// The edit would leave the clip with no visible duration.
    EmptyDuration,
    /// The clip would start before the beginning of the timeline.
    NegativeStart,
    /// A trim offset was negative.
    NegativeTrim,
    /// The trimmed window reaches past the end of the source media.
    TrimExceedsSource,
}

impl core::fmt::Display for GeometryError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let message = match self {
            Self::SplitOutsideClip => "split point is outside the clip",
            Self::EmptyDuration => "edit would leave the clip with no duration",
            Self::NegativeStart => "clip would start before zero",
            Self::NegativeTrim => "trim offsets cannot be negative",
            Self::TrimExceedsSource => "trimmed window exceeds the source duration",
        };
        f.write_str(message)
    }
}

/// A clip's placement on the timeline and the window it reads from its source.
///
/// `duration` is timeline time. `trim_start` and `trim_end` are source time
/// measured inward from each end of the source media, which is why a retimed
/// clip converts between the two whenever a boundary moves.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipSpan {
    pub start_time: MediaTime,
    pub duration: MediaTime,
    pub trim_start: MediaTime,
    pub trim_end: MediaTime,
}

/// The two halves produced by a split. A retained side is `None`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SplitSpans {
    pub left: Option<ClipSpan>,
    pub right: Option<ClipSpan>,
}

impl ClipSpan {
    pub fn new(
        start_time: MediaTime,
        duration: MediaTime,
        trim_start: MediaTime,
        trim_end: MediaTime,
    ) -> Self {
        Self {
            start_time,
            duration,
            trim_start,
            trim_end,
        }
    }

    pub fn end_time(&self) -> MediaTime {
        self.start_time + self.duration
    }

    pub fn contains(&self, time: MediaTime) -> bool {
        time >= self.start_time && time < self.end_time()
    }

    /// Places the clip at `start_time`, keeping its source window.
    pub fn moved_to(&self, start_time: MediaTime) -> Result<Self, GeometryError> {
        if start_time < MediaTime::ZERO {
            return Err(GeometryError::NegativeStart);
        }
        Ok(Self { start_time, ..*self })
    }

    /// Retargets the clip's source window.
    ///
    /// `duration` and `start_time` are optional so a caller can trim the head
    /// (which moves both) or the tail (which moves neither) through one entry
    /// point. `source_duration` enables the bounds check when it is known.
    pub fn trimmed(
        &self,
        trim_start: MediaTime,
        trim_end: MediaTime,
        start_time: Option<MediaTime>,
        duration: Option<MediaTime>,
        source_duration: Option<MediaTime>,
        retime: Retime,
    ) -> Result<Self, GeometryError> {
        if trim_start < MediaTime::ZERO || trim_end < MediaTime::ZERO {
            return Err(GeometryError::NegativeTrim);
        }

        let next = Self {
            start_time: start_time.unwrap_or(self.start_time),
            duration: duration.unwrap_or(self.duration),
            trim_start,
            trim_end,
        };

        if next.start_time < MediaTime::ZERO {
            return Err(GeometryError::NegativeStart);
        }
        if next.duration <= MediaTime::ZERO {
            return Err(GeometryError::EmptyDuration);
        }

        if let Some(source_duration) = source_duration {
            let consumed = trim_start + retime.source_span(next.duration) + trim_end;
            if consumed > source_duration {
                return Err(GeometryError::TrimExceedsSource);
            }
        }

        Ok(next)
    }

    /// Splits the clip at an absolute timeline time.
    ///
    /// The source-side split point is rounded once and the right half is derived
    /// from it, so that `left source span + right source span` always equals the
    /// clip's total source span. Rounding each half independently would let a
    /// one-tick error desynchronise them.
    pub fn split_at(
        &self,
        split_time: MediaTime,
        retain: RetainSide,
        retime: Retime,
    ) -> Result<SplitSpans, GeometryError> {
        if split_time <= self.start_time || split_time >= self.end_time() {
            return Err(GeometryError::SplitOutsideClip);
        }

        let left_duration = split_time - self.start_time;
        let right_duration = self.duration - left_duration;

        let left_source_span = retime.source_span(left_duration);
        let total_source_span = retime.source_span(self.duration);
        let right_source_span = total_source_span - left_source_span;

        let left = Self {
            start_time: self.start_time,
            duration: left_duration,
            trim_start: self.trim_start,
            trim_end: self.trim_end + right_source_span,
        };
        let right = Self {
            start_time: split_time,
            duration: right_duration,
            trim_start: self.trim_start + left_source_span,
            trim_end: self.trim_end,
        };

        Ok(match retain {
            RetainSide::Both => SplitSpans {
                left: Some(left),
                right: Some(right),
            },
            RetainSide::Left => SplitSpans {
                left: Some(left),
                right: None,
            },
            RetainSide::Right => SplitSpans {
                left: None,
                right: Some(right),
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{ClipSpan, GeometryError, RetainSide};
    use crate::retime::Retime;
    use time::MediaTime;

    fn ticks(value: i64) -> MediaTime {
        MediaTime::from_ticks(value)
    }

    fn clip() -> ClipSpan {
        ClipSpan::new(ticks(1_000), ticks(4_000), ticks(500), ticks(250))
    }

    #[test]
    fn splits_a_clip_into_adjoining_halves() {
        let split = clip()
            .split_at(ticks(3_000), RetainSide::Both, Retime::NONE)
            .expect("split inside the clip");
        let left = split.left.expect("left half");
        let right = split.right.expect("right half");

        assert_eq!(left.start_time, ticks(1_000));
        assert_eq!(left.duration, ticks(2_000));
        assert_eq!(right.start_time, ticks(3_000));
        assert_eq!(right.duration, ticks(2_000));
        assert_eq!(left.end_time(), right.start_time);
    }

    #[test]
    fn split_preserves_the_total_source_window() {
        let original = clip();
        let retime = Retime::new(1.7);
        let split = original
            .split_at(ticks(2_317), RetainSide::Both, retime)
            .expect("split inside the clip");
        let left = split.left.expect("left half");
        let right = split.right.expect("right half");

        let total = retime.source_span(original.duration);
        let left_span = right.trim_start - original.trim_start;
        let right_span = left.trim_end - original.trim_end;

        assert_eq!(left_span + right_span, total);
        assert_eq!(left_span, retime.source_span(left.duration));
        assert_eq!(left.trim_start, original.trim_start);
        assert_eq!(right.trim_end, original.trim_end);
    }

    #[test]
    fn split_durations_always_sum_to_the_original() {
        let original = clip();
        let retime = Retime::new(1.7);
        let total = retime.source_span(original.duration);

        for offset in 1..4_000 {
            let split = original
                .split_at(ticks(1_000 + offset), RetainSide::Both, retime)
                .expect("split inside the clip");
            let left = split.left.expect("left half");
            let right = split.right.expect("right half");

            assert_eq!(left.duration + right.duration, original.duration);

            let left_span = right.trim_start - original.trim_start;
            let right_span = left.trim_end - original.trim_end;
            assert_eq!(left_span + right_span, total);
        }
    }

    #[test]
    fn retains_a_single_side_when_asked() {
        let left_only = clip()
            .split_at(ticks(3_000), RetainSide::Left, Retime::NONE)
            .expect("split inside the clip");
        assert!(left_only.left.is_some());
        assert!(left_only.right.is_none());

        let right_only = clip()
            .split_at(ticks(3_000), RetainSide::Right, Retime::NONE)
            .expect("split inside the clip");
        assert!(right_only.left.is_none());
        assert!(right_only.right.is_some());
    }

    #[test]
    fn rejects_splits_on_or_outside_the_clip_bounds() {
        for at in [0, 1_000, 5_000, 9_000] {
            assert_eq!(
                clip().split_at(ticks(at), RetainSide::Both, Retime::NONE),
                Err(GeometryError::SplitOutsideClip)
            );
        }
    }

    #[test]
    fn moves_a_clip_without_touching_its_source_window() {
        let moved = clip().moved_to(ticks(9_000)).expect("move onto timeline");
        assert_eq!(moved.start_time, ticks(9_000));
        assert_eq!(moved.duration, clip().duration);
        assert_eq!(moved.trim_start, clip().trim_start);
        assert_eq!(moved.trim_end, clip().trim_end);
    }

    #[test]
    fn rejects_moves_before_the_start_of_the_timeline() {
        assert_eq!(
            clip().moved_to(ticks(-1)),
            Err(GeometryError::NegativeStart)
        );
    }

    #[test]
    fn trims_within_the_source_duration() {
        let trimmed = clip()
            .trimmed(
                ticks(800),
                ticks(250),
                Some(ticks(1_300)),
                Some(ticks(3_700)),
                Some(ticks(5_000)),
                Retime::NONE,
            )
            .expect("trim inside the source");
        assert_eq!(trimmed.trim_start, ticks(800));
        assert_eq!(trimmed.duration, ticks(3_700));
    }

    #[test]
    fn rejects_trims_that_run_past_the_source() {
        assert_eq!(
            clip().trimmed(
                ticks(800),
                ticks(250),
                None,
                Some(ticks(4_500)),
                Some(ticks(5_000)),
                Retime::NONE,
            ),
            Err(GeometryError::TrimExceedsSource)
        );
    }

    #[test]
    fn rejects_negative_trims_and_empty_durations() {
        assert_eq!(
            clip().trimmed(ticks(-1), ticks(0), None, None, None, Retime::NONE),
            Err(GeometryError::NegativeTrim)
        );
        assert_eq!(
            clip().trimmed(ticks(0), ticks(0), None, Some(ticks(0)), None, Retime::NONE),
            Err(GeometryError::EmptyDuration)
        );
    }
}
