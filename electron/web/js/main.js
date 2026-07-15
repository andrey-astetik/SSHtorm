let APP = window.app;
let ttsEnabled = false;
let appState = {}; 
let chat = [];
let imgsList = {};

let lastAppState = '';
const appReciever = e => {
    // console.log(e);
    switch(e.method) {
        case 'toast':
            toast(e.data);
            break;

        case 'stateUpdate':
            if (e.data.hash != lastAppState) {
                lastAppState = e.data.hash;
                appState = e.data.state;
                
                $('#settings-toLang').val(appState.settings.toLang).change();
                $('#settings-fromLang').val(appState.settings.fromLang).change();
                drawMsg(appState.translationField);
            }
            break;
    }
}

const sendMessage = (text='') => {
    if (text.trim() == '') return false;

    APP.send({
        method: 'sendMsg',
        data: text
    });

    return true;
}

const toast = text => {
    let el = $(`<div style="display: none;">${text}</div>`).appendTo('#chatToasts');
    setTimeout(_ => {
        $(el).fadeIn(250);
        setTimeout(_ => {
            $(el).fadeOut(250);
            setTimeout(_ => {
                $(el).remove();
            },350);
        },5e3);
    },100);
}

const htmlspecialchars = str => {
    if (typeof str !== 'string') {
        return str;
    }
    return str.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // .replace(/\s/g, '&nbsp;')
    .replace(/'/g, '&#039;');
}

const drawMsg = e => {
    let msgText = htmlspecialchars(e);
    $('#toText').val(msgText);
}

const paginator = page => {
    if (appState.activePage != page && $(`[page="${page}"]`).length > 0) {
        $('#pages').children().fadeOut(250, _ => {
            setTimeout(_ => {
                appState.activePage = page;
                $('#pages').children(`[page="${page}"]`).fadeIn(250);

                if (page == 'translator') $('#fromText').focus();
            },250);
        });
    }
}

$('#settings-fromLang').change(function() {
    if ($(this).val() != null && $(this).val() != appState.settings.fromLang) {
        APP.send({method: 'settings', data: {
            field: 'fromLang',
            value: $(this).val()
        }});
    }
});
$('#settings-toLang').change(function() {
    if ($(this).val() != null && $(this).val() != appState.settings.toLang) {
        APP.send({method: 'settings', data: {
            field: 'toLang',
            value: $(this).val()
        }});
    }
});

$('[tocb]').click(function() {
    var text = $(this).attr('tocb');
    navigator.clipboard.writeText(text).then(_ => {
        toast('Cкопировано в буфер обмена');
    }, _ => {
        toast('Не удалось скопировать');
    });
});

$('#fromText').on('click keyup keydown focus blur', function() {
    let text = $('#fromText').val().trim();
    APP.send({method: 'inputField', data: text});
});
$('#fromText').on('keypress', function(e) {
    if (!e.originalEvent.shiftKey && e.originalEvent.code == 'Enter') {
        e.preventDefault();
        
        let text = $('#fromText').val().trim();
        $('#fromText').val(text);
        sendMessage(text);
    }
});

$('body').keypress(e => {
    if ($(':focus').length == 0 && /^.{1}$/.test(e.key)) $('#fromText').focus();
});

APP.recieve(e => appReciever(e));
APP.send({method: 'ready'});