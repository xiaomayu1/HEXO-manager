#ifndef HEXOPREVIEWWIDGET_H
#define HEXOPREVIEWWIDGET_H

#include <QWidget>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QPlainTextEdit>
#include <QProcess>
#include <QTcpServer>
#include <QTimer>
#include <QDesktopServices>
#include <QUrl>
#include <QSettings>
#include <QMessageBox>
#include <QDateTime>

class HexoPreviewWidget : public QWidget
{
    Q_OBJECT

public:
    enum class State { Idle, Installing, Starting, Running, Failed };
    Q_ENUM(State)

    explicit HexoPreviewWidget(QWidget *parent = nullptr);
    ~HexoPreviewWidget() override;

    QString blogPath() const;
    void    setBlogPath(const QString &path);

signals:
    void stateChanged(HexoPreviewWidget::State state, const QString &port);
    void logLine(const QString &line);

public slots:
    void startPreview();
    void stopPreview();

private slots:
    void onBrowseClicked();
    void onInstallFinished(int exitCode, QProcess::ExitStatus exitStatus);
    void onServerFinished(int exitCode, QProcess::ExitStatus exitStatus);
    void onServerError(QProcess::ProcessError error);
    void onStdoutReady();
    void onStderrReady();
    void onServerReady();

private:
    bool checkNodeInstalled();
    bool checkNpmInstalled();
    bool checkHexoInstalled();
    int  findFreePort(int startPort = 4001, int maxTries = 20);
    bool isPortInUse(int port);

    void buildUI();
    void updateState(State state, int port = -1);
    void appendLog(const QString &msg);
    QString timestamp() const;
    QString processErrorString(QProcess::ProcessError error) const;
    QString exitStatusString(QProcess::ExitStatus status) const;
    void    stopProcess();
    void    runNpmInstall(const QString &blogPath);
    void    startHexoServer(const QString &blogPath, int port);
    void    runEnvironmentDetect();

    QLineEdit  *m_pathEdit;
    QPushButton *m_browseBtn;
    QPushButton *m_startBtn;
    QPushButton *m_stopBtn;
    QLabel      *m_statusLabel;
    QLabel      *m_envLabel;
    QPlainTextEdit *m_logView;

    QProcess  *m_installProc;
    QProcess  *m_serverProc;

    QSettings   m_settings;
    State       m_state;
    int         m_port;
    QString     m_blogPath;
    bool        m_stopping;
};

#endif // HEXOPREVIEWWIDGET_H
