#include "hexopreviewwidget.h"
#include <QApplication>
#include <QStyleFactory>
#include <QMainWindow>
#include <QStatusBar>

int main(int argc, char *argv[])
{
    QApplication a(argc, argv);
    a.setStyle(QStyleFactory::create(QStringLiteral("Fusion")));

    QPalette dark;
    dark.setColor(QPalette::Window,      QColor(30,30,46));
    dark.setColor(QPalette::WindowText,  QColor(205,214,244));
    dark.setColor(QPalette::Base,        QColor(22,32,50));
    dark.setColor(QPalette::AlternateBase,QColor(26,39,64));
    dark.setColor(QPalette::Text,        QColor(205,214,244));
    dark.setColor(QPalette::Button,      QColor(30,30,46));
    dark.setColor(QPalette::ButtonText,  QColor(205,214,244));
    dark.setColor(QPalette::Highlight,   QColor(59,130,246));
    dark.setColor(QPalette::HighlightedText,QColor(255,255,255));
    a.setPalette(dark);

    QFont f(QStringLiteral("Microsoft YaHei UI"), 9);
    a.setFont(f);

    QMainWindow window;
    window.setWindowTitle(QStringLiteral("Hexo 博客预览"));
    window.resize(820, 680);
    window.setMinimumSize(600, 480);

    HexoPreviewWidget *preview = new HexoPreviewWidget(&window);
    window.setCentralWidget(preview);

    QStatusBar *sb = window.statusBar();
    if (sb) sb->showMessage(QStringLiteral("就绪 — 请选择博客目录后点击「启动预览」"));

    window.show();
    return a.exec();
}
