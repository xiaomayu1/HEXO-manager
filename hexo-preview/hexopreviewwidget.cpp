#include "hexopreviewwidget.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QFormLayout>
#include <QGroupBox>
#include <QFileDialog>
#include <QLabel>
#include <QMessageBox>
#include <QScrollBar>
#include <QRegularExpression>
#include <QDir>
#include <QSysInfo>
#include <QDebug>
#include <QCoreApplication>

// ═══════════════════════════════════════════════════════════
//  构造函数
// ═══════════════════════════════════════════════════════════
HexoPreviewWidget::HexoPreviewWidget(QWidget *parent)
    : QWidget(parent)
    , m_installProc(nullptr)
    , m_serverProc(nullptr)
    , m_port(-1)
    , m_state(State::Idle)
    , m_stopping(false)
{
    setObjectName(QStringLiteral("hexoPreviewWidget"));
    buildUI();

    // 从 QSettings 恢复上次博客路径
    QSettings settings;
    m_blogPath = settings.value(QStringLiteral("hexo/blogPath"), QString()).toString();
    if (!m_blogPath.isEmpty())
        m_pathEdit->setText(m_blogPath);

    // 启动时自动检测环境
    QTimer::singleShot(300, this, [this]() { runEnvironmentDetect(); });
}

HexoPreviewWidget::~HexoPreviewWidget()
{
    stopProcess();
}

QString HexoPreviewWidget::blogPath() const
{
    return m_blogPath;
}

void HexoPreviewWidget::setBlogPath(const QString &path)
{
    m_blogPath = path;
    m_pathEdit->setText(path);
    QSettings().setValue(QStringLiteral("hexo/blogPath"), path);
}

// ═══════════════════════════════════════════════════════════
//  UI 构建
// ═══════════════════════════════════════════════════════════
void HexoPreviewWidget::buildUI()
{
    auto *mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(12, 8, 12, 12);
    mainLayout->setSpacing(10);

    // ── 控制区 ──
    auto *ctrlGroup = new QGroupBox(QStringLiteral("预览控制"), this);
    auto *formLayout = new QFormLayout(ctrlGroup);
    formLayout->setRowWrapPolicy(QFormLayout::DontWrapRows);
    formLayout->setLabelAlignment(Qt::AlignRight | Qt::AlignVCenter);
    formLayout->setFieldGrowthPolicy(QFormLayout::ExpandingFieldsGrow);
    formLayout->setSpacing(8);

    // 博客路径
    auto *pathLayout = new QHBoxLayout();
    m_pathEdit = new QLineEdit(this);
    m_pathEdit->setPlaceholderText(
        QStringLiteral("请选择或输入 Hexo 博客根目录（含 _config.yml）"));
    pathLayout->addWidget(m_pathEdit);
    m_browseBtn = new QPushButton(QStringLiteral("浏览…"), this);
    pathLayout->addWidget(m_browseBtn);
    formLayout->addRow(QStringLiteral("博客目录："), m_pathEdit);
    formLayout->addRow(QString(), m_browseBtn);

    // 按钮行
    auto *btnLayout = new QHBoxLayout();
    m_startBtn = new QPushButton(QStringLiteral("▶ 启动预览"), this);
    m_stopBtn  = new QPushButton(QStringLiteral("■ 停止"), this);
    m_stopBtn->setEnabled(false);
    btnLayout->addStretch();
    btnLayout->addWidget(m_startBtn);
    btnLayout->addWidget(m_stopBtn);
    formLayout->addRow(QString(), btnLayout);

    // 状态行
    auto *statusLayout = new QHBoxLayout();
    m_statusLabel = new QLabel(QStringLiteral("环境检测中…"), this);
    m_envLabel    = new QLabel(QStringLiteral(""), this);
    statusLayout->addWidget(m_statusLabel);
    statusLayout->addStretch();
    statusLayout->addWidget(m_envLabel);
    formLayout->addRow(QStringLiteral("状态："), statusLayout);

    mainLayout->addWidget(ctrlGroup);

    // ── 日志区 ──
    auto *logTitleLayout = new QHBoxLayout();
    auto *logTitle = new QLabel(QStringLiteral(" 运行日志"), this);
    logTitle->setStyleSheet(
        QStringLiteral("font-weight:bold; font-size:13px; color:#d4d4d4;"));
    logTitleLayout->addWidget(logTitle);
    logTitleLayout->addStretch();
    auto *clearBtn = new QPushButton(QStringLiteral("清空"), this);
    clearBtn->setStyleSheet(
        QStringLiteral("padding:2px 10px; font-size:12px;"));
    logTitleLayout->addWidget(clearBtn);
    mainLayout->addLayout(logTitleLayout);

    m_logView = new QPlainTextEdit(this);
    m_logView->setReadOnly(true);
    m_logView->setPlaceholderText(
        QStringLiteral("日志将在此显示……\n\n提示：启动预览后 hexo server 的 stdout/stderr "
                       "会实时出现在这里。"));
    m_logView->setMaximumHeight(220);
    m_logView->setStyleSheet(
        QStringLiteral("QPlainTextEdit {"
                       "  background:#1e1e1e; color:#d4d4d4;"
                       "  font-family:'Cascadia Code','Consolas','Courier New',monospace;"
                       "  font-size:12px; padding:6px;"
                       "  border:1px solid #3c3c3c;"
                       "}"));
    mainLayout->addWidget(m_logView);

    connect(m_browseBtn, &QPushButton::clicked, this, &HexoPreviewWidget::onBrowseClicked);
    connect(m_startBtn,  &QPushButton::clicked, this, &HexoPreviewWidget::startPreview);
    connect(m_stopBtn,   &QPushButton::clicked, this, &HexoPreviewWidget::stopPreview);
    connect(clearBtn,    &QPushButton::clicked, m_logView, &QPlainTextEdit::clear);
}

// ═══════════════════════════════════════════════════════════
//  环境检测
// ═══════════════════════════════════════════════════════════
bool HexoPreviewWidget::checkNodeInstalled()
{
    QProcess proc;
    proc.setProgram(QStringLiteral("node"));
    proc.setArguments({QStringLiteral("--version")});
    proc.setProcessChannelMode(QProcess::MergedChannels);
    proc.start();
    proc.waitForFinished(5000);
    bool ok = (proc.exitCode() == 0);
    if (ok)
        appendLog(QStringLiteral("[环境] Node.js  OK  %1").arg(proc.readAllStandardOutput().trimmed()));
    else
        appendLog(QStringLiteral("[环境] Node.js  FAIL  未检测到 Node.js，请安装：https://nodejs.org"));
    return ok;
}

bool HexoPreviewWidget::checkNpmInstalled()
{
    QProcess proc;
    proc.setProgram(QStringLiteral("npm"));
    proc.setArguments({QStringLiteral("--version")});
    proc.setProcessChannelMode(QProcess::MergedChannels);
    proc.start();
    proc.waitForFinished(5000);
    bool ok = (proc.exitCode() == 0);
    if (ok)
        appendLog(QStringLiteral("[环境] npm     OK  %1").arg(proc.readAllStandardOutput().trimmed()));
    else
        appendLog(QStringLiteral("[环境] npm     FAIL  未检测到 npm，请检查 Node.js 安装"));
    return ok;
}

bool HexoPreviewWidget::checkHexoInstalled()
{
    QProcess proc;
    proc.setProgram(QStringLiteral("hexo"));
    proc.setArguments({QStringLiteral("--version")});
    proc.setProcessChannelMode(QProcess::MergedChannels);
    proc.start();
    proc.waitForFinished(5000);
    bool ok = (proc.exitCode() == 0);
    if (ok) {
        QByteArray out = proc.readAllStandardOutput();
        QString outStr(out);
        QStringList lines = outStr.split('\n');
        QString ver = lines.isEmpty() ? out.trimmed() : lines.first().trimmed();
        appendLog(QStringLiteral("[环境] Hexo CLI  OK  %1").arg(ver));
    } else {
        appendLog(QStringLiteral("[环境] Hexo CLI  FAIL  未检测到 hexo-cli，请运行：npm install -g hexo-cli"));
    }
    return ok;
}

void HexoPreviewWidget::runEnvironmentDetect()
{
    bool nodeOk  = checkNodeInstalled();
    bool npmOk   = checkNpmInstalled();
    bool hexoOk  = checkHexoInstalled();

    if (nodeOk && npmOk && hexoOk) {
        m_envLabel->setText(QStringLiteral("  环境就绪"));
        m_envLabel->setStyleSheet(QStringLiteral("color:#4ade80; font-weight:bold;"));
        appendLog(QStringLiteral("[环境] 全部检测通过，可以启动预览"));
    } else {
        QStringList missing;
        if (!nodeOk) missing.append(QStringLiteral("Node.js"));
        if (!npmOk)  missing.append(QStringLiteral("npm"));
        if (!hexoOk) missing.append(QStringLiteral("Hexo CLI"));
        m_envLabel->setText(QStringLiteral("  缺少：%1").arg(missing.join(QStringLiteral("、"))));
        m_envLabel->setStyleSheet(QStringLiteral("color:#fb923c; font-weight:bold;"));
        QMessageBox::warning(this,
                             QStringLiteral("环境检测失败"),
                             QStringLiteral("以下工具未检测到，预览功能将受限：\n\n  • %1\n\n"
                                           "Node.js 与 Hexo CLI 可在系统终端中安装。")
                                 .arg(missing.join(QStringLiteral("\n  • "))));
    }
}

// ═══════════════════════════════════════════════════════════
//  端口探测
// ═══════════════════════════════════════════════════════════
bool HexoPreviewWidget::isPortInUse(int port)
{
    QTcpServer tester;
    return !tester.listen(QHostAddress::LocalHost, port);
}

int HexoPreviewWidget::findFreePort(int startPort, int maxTries)
{
    for (int p = startPort; p < startPort + maxTries; ++p) {
        if (!isPortInUse(p)) {
            appendLog(QStringLiteral("[端口] 找到空闲端口：%1").arg(p));
            return p;
        }
    }
    appendLog(QStringLiteral("[端口] 未能找到空闲端口（尝试了 %1 个）").arg(maxTries));
    return -1;
}

// ═══════════════════════════════════════════════════════════
//  启动预览
// ═══════════════════════════════════════════════════════════
void HexoPreviewWidget::startPreview()
{
    QString blogPath = m_pathEdit->text().trimmed();
    if (blogPath.isEmpty()) {
        QMessageBox::warning(this,
                             QStringLiteral("缺少博客路径"),
                             QStringLiteral("请先在上方文本框中输入或选择 Hexo 博客根目录。"));
        return;
    }
    QDir blogDir(blogPath);
    if (!blogDir.exists()) {
        QMessageBox::critical(this,
                              QStringLiteral("目录不存在"),
                              QStringLiteral("指定的博客目录不存在：\n%1").arg(blogPath));
        return;
    }
    m_blogPath = blogPath;
    QSettings().setValue(QStringLiteral("hexo/blogPath"), blogPath);

    // 已有进程在运行
    if (m_serverProc && m_serverProc->state() == QProcess::Running) {
        QMessageBox::information(this,
                                 QStringLiteral("已在运行"),
                                 QStringLiteral("预览服务已在端口 %1 运行中，请先点击「停止」。").arg(m_port));
        return;
    }
    stopProcess();

    // 检查 node_modules
    QString nmPath = blogPath + QStringLiteral("/node_modules");
    if (!QDir(nmPath).exists()) {
        appendLog(QStringLiteral("[安装] 未检测到 node_modules，开始执行 npm install …"));
        updateState(State::Installing);
        runNpmInstall(blogPath);
        return;
    }

    // 找端口
    m_port = findFreePort(4001, 20);
    if (m_port < 0) {
        updateState(State::Failed);
        QMessageBox::critical(this,
                              QStringLiteral("端口不足"),
                              QStringLiteral("无法找到空闲端口（4001–4020 均被占用）。"));
        return;
    }
    startHexoServer(blogPath, m_port);
}

void HexoPreviewWidget::runNpmInstall(const QString &blogPath)
{
    m_installProc = new QProcess(this);
    m_installProc->setWorkingDirectory(blogPath);
    m_installProc->setProcessChannelMode(QProcess::MergedChannels);

    connect(m_installProc, QOverload<int,QProcess::ExitStatus>::of(&QProcess::finished),
            this, &HexoPreviewWidget::onInstallFinished);
    connect(m_installProc, &QProcess::readyReadStandardOutput, this, [this]() {
        QByteArray data = m_installProc->readAllStandardOutput();
        if (!data.isEmpty()) {
            QString line = QString::fromUtf8(data).trimmed();
            if (!line.isEmpty()) appendLog(QStringLiteral("[npm]  %1").arg(line));
        }
    });
    connect(m_installProc, &QProcess::readyReadStandardError, this, [this]() {
        QByteArray data = m_installProc->readAllStandardError();
        if (!data.isEmpty()) {
            QString line = QString::fromUtf8(data).trimmed();
            if (!line.isEmpty()) appendLog(QStringLiteral("[npm]  %1").arg(line));
        }
    });

    appendLog(QStringLiteral("[npm] 正在运行 npm install …（首次安装可能需数分钟）"));
    m_startBtn->setEnabled(false);
    m_startBtn->setText(QStringLiteral("安装中…"));
    m_installProc->start(QStringLiteral("npm"), {QStringLiteral("install")});
    if (!m_installProc->waitForStarted(5000)) {
        appendLog(QStringLiteral("[npm] 启动失败：无法启动 npm 进程"));
        QMessageBox::critical(this,
                              QStringLiteral("启动失败"),
                              QStringLiteral("无法启动 npm 进程，请确认 npm 已在系统 PATH 中。"));
        updateState(State::Failed);
        m_startBtn->setEnabled(true);
        m_startBtn->setText(QStringLiteral("▶ 启动预览"));
    }
}

void HexoPreviewWidget::onInstallFinished(int exitCode, QProcess::ExitStatus exitStatus)
{
    m_installProc->deleteLater();
    m_installProc = nullptr;
    m_startBtn->setEnabled(true);
    m_startBtn->setText(QStringLiteral("▶ 启动预览"));

    if (exitStatus != QProcess::NormalExit || exitCode != 0) {
        appendLog(QStringLiteral("[npm] npm install 失败，退出码：%1").arg(exitCode));
        updateState(State::Failed);
        QMessageBox::critical(this,
                              QStringLiteral("npm install 失败"),
                              QStringLiteral("安装依赖时出错，请查看上方日志。\n\n可能原因：\n"
                                           "  • 网络连接问题\n"
                                           "  • package.json 中存在无法解析的依赖\n"
                                           "  • 权限不足"));
        return;
    }

    appendLog(QStringLiteral("[安装] npm install 完成，准备启动预览…"));
    m_port = findFreePort(4001, 20);
    if (m_port < 0) {
        updateState(State::Failed);
        QMessageBox::critical(this, QStringLiteral("端口不足"),
                              QStringLiteral("安装完成但无法找到空闲端口。"));
        return;
    }
    startHexoServer(m_blogPath, m_port);
}

void HexoPreviewWidget::startHexoServer(const QString &blogPath, int port)
{
    m_serverProc = new QProcess(this);
    m_serverProc->setWorkingDirectory(blogPath);
    m_serverProc->setProcessChannelMode(QProcess::MergedChannels);

    connect(m_serverProc, QOverload<int,QProcess::ExitStatus>::of(&QProcess::finished),
            this, &HexoPreviewWidget::onServerFinished);
    connect(m_serverProc, &QProcess::readyReadStandardOutput, this, &HexoPreviewWidget::onStdoutReady);
    connect(m_serverProc, &QProcess::readyReadStandardError,  this, &HexoPreviewWidget::onStderrReady);

    appendLog(QStringLiteral("[server] 正在启动 hexo server -p %1 …").arg(port));
    m_startBtn->setEnabled(false);
    m_startBtn->setText(QStringLiteral("启动中…"));
    m_stopBtn->setEnabled(true);
    m_stopping = false;
    updateState(State::Starting, port);

    QStringList args;
    args << QStringLiteral("server") << QStringLiteral("-p") << QString::number(port);
    m_serverProc->start(QStringLiteral("hexo"), args);
    if (!m_serverProc->waitForStarted(10000)) {
        appendLog(QStringLiteral("[server] 启动 hexo server 失败"));
        QMessageBox::critical(this,
                              QStringLiteral("启动失败"),
                              QStringLiteral("无法启动 hexo server，请确认 hexo-cli 已安装。\n\n"
                                           "命令：%1 %2")
                                  .arg(QStringLiteral("hexo"), args.join(QStringLiteral(" "))));
        updateState(State::Failed);
        m_startBtn->setEnabled(true);
        m_startBtn->setText(QStringLiteral("▶ 启动预览"));
        m_stopBtn->setEnabled(false);
    }
}

// ═══════════════════════════════════════════════════════════
//  进程事件处理
// ═══════════════════════════════════════════════════════════
void HexoPreviewWidget::onStdoutReady()
{
    QByteArray data = m_serverProc->readAllStandardOutput();
    if (data.isEmpty()) return;
    QString text = QString::fromUtf8(data);
    QStringList lines = text.split('\n', Qt::SkipEmptyParts);
    for (const QString &line : lines)
        appendLog(QStringLiteral("[server] %1").arg(line.trimmed()));

    // 检测就绪信号
    if (!m_stopping && text.contains(QRegularExpression(QStringLiteral("Hexo is running|is running at http")))) {
        onServerReady();
    }
}

void HexoPreviewWidget::onStderrReady()
{
    QByteArray data = m_serverProc->readAllStandardError();
    if (data.isEmpty()) return;
    QString text = QString::fromUtf8(data);
    QStringList lines = text.split('\n', Qt::SkipEmptyParts);
    for (const QString &line : lines)
        appendLog(QStringLiteral("[server err] %1").arg(line.trimmed()));
}

void HexoPreviewWidget::onServerReady()
{
    m_state = State::Running;
    updateState(State::Running, m_port);
    m_startBtn->setEnabled(true);
    m_startBtn->setText(QStringLiteral("⟳ 重启"));
    appendLog(QStringLiteral("[server] 预览就绪，正在打开浏览器…"));

    QUrl url = QUrl::fromUserInput(QStringLiteral("http://localhost:%1").arg(m_port));
    QDesktopServices::openUrl(url);

    emit stateChanged(m_state, QString::number(m_port));
}

void HexoPreviewWidget::onServerError(QProcess::ProcessError error)
{
    appendLog(QStringLiteral("[server] 进程错误：%1").arg(processErrorString(error)));
    if (m_state != State::Failed && !m_stopping) {
        updateState(State::Failed);
        QMessageBox::critical(this,
                              QStringLiteral("预览失败"),
                              QStringLiteral("hexo server 进程发生错误：%1\n\n请检查博客配置。")
                                  .arg(processErrorString(error)));
    }
}

void HexoPreviewWidget::onServerFinished(int exitCode, QProcess::ExitStatus exitStatus)
{
    if (m_state == State::Running && !m_stopping) {
        appendLog(QStringLiteral("[server] 进程意外退出，退出码：%1，状态：%2")
                      .arg(exitCode).arg(exitStatusString(exitStatus)));
        updateState(State::Failed);
        QMessageBox::warning(this,
                             QStringLiteral("预览已停止"),
                             QStringLiteral("hexo server 进程已退出（退出码 %1），预览已断开。").arg(exitCode));
    }
    m_serverProc->deleteLater();
    m_serverProc = nullptr;
    m_startBtn->setEnabled(true);
    m_startBtn->setText(QStringLiteral("▶ 启动预览"));
    m_stopBtn->setEnabled(false);
}

// ═══════════════════════════════════════════════════════════
//  停止预览
// ═══════════════════════════════════════════════════════════
void HexoPreviewWidget::stopPreview()
{
    if (m_state != State::Running && m_state != State::Starting) return;
    m_stopping = true;
    appendLog(QStringLiteral("[server] 正在停止预览…"));
    stopProcess();
}

void HexoPreviewWidget::stopProcess()
{
    if (m_installProc) {
        m_installProc->kill();
        m_installProc->waitForFinished(3000);
        m_installProc->deleteLater();
        m_installProc = nullptr;
        appendLog(QStringLiteral("[npm] 已终止安装进程"));
    }
    if (m_serverProc) {
        qint32 pid = m_serverProc->processId();
        // Windows 下用 taskkill /T /F 清理进程树
        if (pid > 0 && QSysInfo::productType() == QStringLiteral("windows")) {
            QStringList tkArgs;
            tkArgs << QStringLiteral("/PID") << QString::number(pid)
                   << QStringLiteral("/T")   << QStringLiteral("/F");
            QProcess::execute(QStringLiteral("taskkill"), tkArgs);
            appendLog(QStringLiteral("[server] taskkill /T /F 已执行，PID=%1").arg(pid));
        } else {
            m_serverProc->terminate();
            if (!m_serverProc->waitForFinished(3000)) {
                m_serverProc->kill();
                m_serverProc->waitForFinished(2000);
            }
            appendLog(QStringLiteral("[server] 进程已终止，PID=%1").arg(pid));
        }
        m_serverProc->deleteLater();
        m_serverProc = nullptr;
    }
    m_stopping = false;
    m_port = -1;
    m_startBtn->setEnabled(true);
    m_startBtn->setText(QStringLiteral("▶ 启动预览"));
    m_stopBtn->setEnabled(false);
    updateState(State::Idle);
    appendLog(QStringLiteral("[server] 预览已完全停止"));
}

// ═══════════════════════════════════════════════════════════
//  辅助函数
// ═══════════════════════════════════════════════════════════
void HexoPreviewWidget::onBrowseClicked()
{
    QString dir = QFileDialog::getExistingDirectory(this,
                                                     QStringLiteral("选择 Hexo 博客目录"),
                                                     m_blogPath.isEmpty() ? QDir::homePath() : m_blogPath,
                                                     QFileDialog::ShowDirsOnly | QFileDialog::DontResolveSymlinks);
    if (!dir.isEmpty())
        setBlogPath(dir);
}

void HexoPreviewWidget::updateState(State state, int port)
{
    m_state = state;
    QString label;
    QString style;
    switch (state) {
    case State::Idle:
        label  = QStringLiteral(" 未启动");
        style  = QStringLiteral("color:#888; font-weight:bold; font-size:14px;");
        break;
    case State::Installing:
        label  = QStringLiteral(" 安装依赖中…");
        style  = QStringLiteral("color:#f59e0b; font-weight:bold; font-size:14px;");
        break;
    case State::Starting:
        label  = QStringLiteral(" 启动中…");
        style  = QStringLiteral("color:#3b82f6; font-weight:bold; font-size:14px;");
        break;
    case State::Running:
        label  = QStringLiteral(" 运行中  端口:") + QString::number(port >= 0 ? port : -1);
        style  = QStringLiteral("color:#22c55e; font-weight:bold; font-size:14px;");
        break;
    case State::Failed:
        label  = QStringLiteral(" 失败");
        style  = QStringLiteral("color:#ef4444; font-weight:bold; font-size:14px;");
        break;
    default:
        label  = QStringLiteral(" 未知");
        style  = QStringLiteral("color:#888; font-weight:bold; font-size:14px;");
        break;
    }
    m_statusLabel->setText(label);
    m_statusLabel->setStyleSheet(style);
    emit stateChanged(state, port >= 0 ? QString::number(port) : QStringLiteral("-1"));
}

void HexoPreviewWidget::appendLog(const QString &msg)
{
    QString line = QStringLiteral("[%1] %2").arg(timestamp(), msg);
    m_logView->appendPlainText(line);
    QScrollBar *sb = m_logView->verticalScrollBar();
    if (sb) sb->setValue(sb->maximum());
    emit logLine(line);
}

QString HexoPreviewWidget::timestamp() const
{
    return QDateTime::currentDateTime().toString(QStringLiteral("hh:mm:ss"));
}

QString HexoPreviewWidget::processErrorString(QProcess::ProcessError error) const
{
    switch (error) {
    case QProcess::FailedToStart:  return QStringLiteral("无法启动进程");
    case QProcess::Crashed:        return QStringLiteral("进程崩溃");
    case QProcess::Timedout:       return QStringLiteral("超时");
    case QProcess::WriteError:     return QStringLiteral("写入错误");
    case QProcess::ReadError:      return QStringLiteral("读取错误");
    case QProcess::UnknownError:   return QStringLiteral("未知错误");
    default:                       return QStringLiteral("错误 %1").arg(error);
    }
}

QString HexoPreviewWidget::exitStatusString(QProcess::ExitStatus status) const
{
    return status == QProcess::NormalExit
           ? QStringLiteral("正常退出")
           : QStringLiteral("异常终止");
}
