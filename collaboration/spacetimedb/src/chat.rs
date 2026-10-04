//! Project chat is separate from timeline revisions and undo history.
use crate::edit::find_project;
use crate::schema::{ChatMessage, chat_message, collaborator, live_session};
use spacetimedb::{ReducerContext, Table};

pub const MAX_MESSAGE_CHARS: usize = 2000;
pub const MAX_PROJECT_MESSAGES: usize = 200;

fn message_text(text: &str) -> Result<String, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Message cannot be empty".into());
    }
    if text.chars().count() > MAX_MESSAGE_CHARS {
        return Err("Message is too long (maximum 2000 characters)".into());
    }
    Ok(text.to_string())
}

#[spacetimedb::reducer]
pub fn send_chat_message(
    ctx: &ReducerContext,
    project_id: String,
    text: String,
) -> Result<(), String> {
    let text = message_text(&text)?;
    find_project(ctx, &project_id)?;
    let connection = ctx
        .connection_id()
        .ok_or("Chat requires an active connection")?;
    let person = ctx
        .db
        .collaborator()
        .connection_id()
        .find(connection)
        .filter(|person| person.project_id == project_id && person.identity == ctx.sender())
        .ok_or("Join this project before sending a message")?;
    if !ctx
        .db
        .live_session()
        .project_id()
        .find(project_id.clone())
        .is_some_and(|session| session.active)
    {
        return Err("The host has not started a live session".into());
    }
    ctx.db.chat_message().insert(ChatMessage {
        id: 0,
        project_id: project_id.clone(),
        author: ctx.sender(),
        author_name: person.display_name,
        text,
        sent_at: ctx.timestamp,
    });
    let mut ids: Vec<u64> = ctx
        .db
        .chat_message()
        .project_id()
        .filter(&project_id)
        .map(|message| message.id)
        .collect();
    ids.sort_unstable();
    let excess = ids.len().saturating_sub(MAX_PROJECT_MESSAGES);
    for id in ids.into_iter().take(excess) {
        ctx.db.chat_message().id().delete(id);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_chat_text() {
        assert_eq!(message_text("  hi there \n").unwrap(), "hi there");
        assert!(message_text(" \n ").is_err());
        assert!(message_text(&"a".repeat(2001)).is_err());
        assert!(message_text(&"é".repeat(2000)).is_ok());
    }
}
