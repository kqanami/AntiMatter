use anchor_lang::prelude::*;

declare_id!("AAVTtyKDe54bhYoHeHkdpRw6tGDUbJkZS8LiwU6pQSdf");

#[program]
pub mod antimatter_learning {
    use super::*;

    // Week 4: the first on-chain instruction. It writes no state.
    pub fn ping(ctx: Context<Ping>) -> Result<()> {
        msg!("ANTIMATTER ping from {}", ctx.accounts.authority.key());
        Ok(())
    }

    // Week 5: one counter per wallet. The wallet pays rent and owns updates.
    pub fn initialize_counter(ctx: Context<InitializeCounter>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.authority = ctx.accounts.authority.key();
        counter.count = 0;
        counter.bump = ctx.bumps.counter;
        Ok(())
    }

    pub fn increment_counter(ctx: Context<IncrementCounter>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = counter.count.checked_add(1).ok_or(LearningError::CounterOverflow)?;
        msg!("Counter {} = {}", counter.authority, counter.count);
        Ok(())
    }

    // Week 6: profile lives at PDA ["profile", authority]. Only its signer can edit it.
    pub fn create_profile(ctx: Context<CreateProfile>, display_name: String, bio: String) -> Result<()> {
        validate_profile(&display_name, &bio)?;
        let profile = &mut ctx.accounts.profile;
        profile.authority = ctx.accounts.authority.key();
        profile.bump = ctx.bumps.profile;
        profile.display_name = display_name;
        profile.bio = bio;
        profile.updated_slot = Clock::get()?.slot;
        Ok(())
    }

    pub fn update_profile(ctx: Context<UpdateProfile>, display_name: String, bio: String) -> Result<()> {
        validate_profile(&display_name, &bio)?;
        let profile = &mut ctx.accounts.profile;
        profile.display_name = display_name;
        profile.bio = bio;
        profile.updated_slot = Clock::get()?.slot;
        Ok(())
    }
}

fn validate_profile(display_name: &str, bio: &str) -> Result<()> {
    require!(!display_name.trim().is_empty(), LearningError::EmptyName);
    require!(display_name.as_bytes().len() <= 32, LearningError::NameTooLong);
    require!(bio.as_bytes().len() <= 160, LearningError::BioTooLong);
    Ok(())
}

#[derive(Accounts)]
pub struct Ping<'info> {
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeCounter<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Counter::SPACE,
        seeds = [b"counter", authority.key().as_ref()],
        bump
    )]
    pub counter: Account<'info, Counter>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct IncrementCounter<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"counter", authority.key().as_ref()],
        bump = counter.bump,
        has_one = authority
    )]
    pub counter: Account<'info, Counter>,
}

#[derive(Accounts)]
pub struct CreateProfile<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Profile::SPACE,
        seeds = [b"profile", authority.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, Profile>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateProfile<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"profile", authority.key().as_ref()],
        bump = profile.bump,
        has_one = authority
    )]
    pub profile: Account<'info, Profile>,
}

#[account]
pub struct Counter {
    pub authority: Pubkey,
    pub count: u64,
    pub bump: u8,
}
impl Counter {
    pub const SPACE: usize = 32 + 8 + 1;
}

#[account]
pub struct Profile {
    pub authority: Pubkey,
    pub bump: u8,
    pub display_name: String,
    pub bio: String,
    pub updated_slot: u64,
}
impl Profile {
    pub const SPACE: usize = 32 + 1 + 4 + 32 + 4 + 160 + 8;
}

#[error_code]
pub enum LearningError {
    #[msg("Counter overflow")]
    CounterOverflow,
    #[msg("Profile name is empty")]
    EmptyName,
    #[msg("Profile name exceeds 32 UTF-8 bytes")]
    NameTooLong,
    #[msg("Profile bio exceeds 160 UTF-8 bytes")]
    BioTooLong,
}
