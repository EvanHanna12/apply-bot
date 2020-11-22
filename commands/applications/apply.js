const Discord = require('discord.js');

module.exports = {
    name: 'apply',
    description: 'Starts the application process.',
    usage: 'apply',
    aliases: ['a'],
    permissions: [],
    botPermissions: [],
    nsfw: false,
    cooldown: 1000,
    ownerOnly: false
}

module.exports.execute = async(bot, msg, args, data) => {
    let prefix = !data.guild.prefix ? bot.config.prefix : data.guild.prefix;

    // Check if in apply channel.
    if(data.guild.appChannel !== null && data.guild.appChannel != msg.channel.id) {
        let embed = new Discord.MessageEmbed()
            .setColor(bot.config.color)
            .setDescription('Invalid channel. Apply in <#' + data.guild.appChannel + '>!');
        return msg.channel.send(embed);
    }

    // Check if apply limit passed.
    if(data.guild.applyLimit && data.member.applyCount >= data.guild.applyLimit) {
        let embed = new Discord.MessageEmbed()
            .setColor(bot.config.color)
            .setDescription('You have passed the application limit of ' + data.guild.applyLimit + '!');
        return msg.channel.send(embed);
    }

    // Prepare application, get questions.
    let applicationsDB = bot.data.getApplicationSchema();
    let application = { user: msg.author.id, guild: msg.guild.id };
    let applicationDB = new applicationsDB(application);
    await applicationDB.save().catch(err => {
        bot.logger.error('MongoDB server DB error - ' + err);
        return bot.embeds.dbError(msg);
    });
    let questionsDB = bot.data.getQuestionSchema();
    let questions = await questionsDB.find({ guild: msg.guild.id }).catch(err => {
        bot.logger.error('MongoDB server DB error - ' + err);
        return bot.embeds.dbError(msg);
    });

    // No questions added?
    if(!questions.length) {
        let embed = new Discord.MessageEmbed()
            .setColor(bot.config.color)
            .setDescription('Well this is awkward. No questions have been set up.')
        return msg.channel.send(embed);
    }

    // Send DM.
    let dmEmbed = new Discord.MessageEmbed()
        .setColor(bot.config.color)
        .setTitle('Application for ' + msg.guild.name)
        .setDescription('Answer the following questions.')
        .setFooter('You can cancel the process anytime by writing ' + prefix + 'cancel.');

    // Init DM applicaiton.
    msg.author.send(dmEmbed).then(async dmMsg => {
        let embed = new Discord.MessageEmbed()
            .setColor(bot.config.color)
            .setAuthor(msg.author.tag, msg.author.displayAvatarURL())
            .setTitle('Application')
            .setDescription('Answer the question in your direct messages.');
        msg.channel.send(embed);

        let answers = [];
        let qNumber = 1;
        let cancel = false;
        for(q in questions) {
            let question = questions[q];
            if(cancel) break;

            // Send question.
            let questionEmbed = new Discord.MessageEmbed()
                .setColor(bot.config.color)
                .setTitle('Question #' + qNumber++)
                .setDescription(question.content)
                .setFooter('You can cancel the process anytime by writing ' + prefix + 'cancel.');
            await dmMsg.channel.send(questionEmbed);

            // Process answer.
            await dmMsg.channel.awaitMessages(m => m.content, { max: 1, time: 300000, errors: ['time'] }).then(async collected => {
                let answer = collected.first().content.trim();

                // Cancel application.
                if(answer.toLowerCase() == prefix + 'cancel') {
                    let embed = new Discord.MessageEmbed()
                        .setColor(bot.config.color)
                        .setDescription('Application cancelled.');
                    dmMsg.channel.send(embed);

                    applicationsDB.deleteOne({ _id: applicationDB._id });
                    cancel = true;
                // Save answer.
                } else {
                    let answerObj = { question: question.content, answer: answer };
                    applicationDB.answers.create(answerObj);
                    answers.push(answerObj);
                }
            }).catch(err => {
                bot.logger.error('Application timeout error - ' + err);

                // 30 seconds passed without answer.
                let embed = new Discord.MessageEmbed()
                    .setColor(bot.config.color)
                    .setDescription('Application timed out.');
                dmMsg.channel.send(embed);

                applicationsDB.deleteOne({ _id: applicationDB._id });
                cancel = true;
            });
        }

        // Application finished.
        if(!cancel) {
            let embed = new Discord.MessageEmbed()
                .setColor(bot.config.color)
                .setDescription('Application finished');
            await dmMsg.channel.send(embed);

            applicationDB.status = 1;
            await applicationDB.save();

            data.member.applyCount += 1;
            await data.member.save();

            let logEmbed = new Discord.MessageEmbed()
                .setColor(bot.config.color)
                .setTitle('Application')
                .setAuthor(msg.author.tag, msg.author.displayAvatarURL())
                .setTimestamp();
            answers.map(a => logEmbed.addField(a.question, a.answer, true));
            let channel = bot.tools.getLogChannel(msg.guild, data);
            await channel.send(logEmbed);
        }
    }).catch(err => {
        bot.logger.error('Application DM error - ' + err);
        let embed = new Discord.MessageEmbed()
            .setColor(bot.config.color)
            .setTitle('Application failed')
            .setDescription('It seems like I can\'t message you. Do you have direct messages disabled?');
        msg.channel.send(embed);
    });
}