//! Clip geometry for the editor timeline.
//!
//! The collaboration reducers and the editor client both resolve edits through
//! this crate so that a move, trim, or split means the same thing on either
//! side of the wire.

mod clip;
mod retime;

pub use clip::{ClipSpan, GeometryError, RetainSide, SplitSpans};
pub use retime::{DEFAULT_RATE, MAX_RATE, MIN_RATE, Retime};
